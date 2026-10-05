using System.Text.Json;
using LteCar.Server.Data;
using LteCar.Shared.Channels;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Services;

/// <summary>
/// Vehicle hardware template descriptor as stored in <c>VehicleTemplates/{key}/config.json</c>.
/// </summary>
public sealed class VehicleTemplateFile
{
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Version { get; set; }
    public string? Author { get; set; }
    public DateTime? Created { get; set; }
    public ChannelMap ChannelMap { get; set; } = new();
}

/// <summary>
/// Manages <see cref="ChannelTemplate"/> entities in the database. Seeds templates from
/// <c>VehicleTemplates/</c> at startup and applies them to cars on demand.
/// </summary>
public class ChannelTemplateService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly IWebHostEnvironment _hostEnvironment;
    private readonly ILogger<ChannelTemplateService> _logger;

    public ChannelTemplateService(
        IServiceProvider serviceProvider,
        IWebHostEnvironment hostEnvironment,
        ILogger<ChannelTemplateService> logger)
    {
        _serviceProvider = serviceProvider;
        _hostEnvironment = hostEnvironment;
        _logger = logger;
    }

    /// <summary>
    /// Seeds the database with templates found in <c>VehicleTemplates/</c>.
    /// Existing templates are updated only when the channel map hash changed.
    /// </summary>
    public async Task SeedAsync(CancellationToken cancellationToken = default)
    {
        using var scope = _serviceProvider.CreateScope();
        await using var db = scope.ServiceProvider.GetRequiredService<LteCarContext>();

        var templateDir = GetTemplateDirectory();
        if (!Directory.Exists(templateDir))
        {
            _logger.LogInformation("No VehicleTemplates directory found at {Path}; skipping seed.", templateDir);
            return;
        }

        foreach (var configPath in Directory.EnumerateFiles(templateDir, "config.json", SearchOption.AllDirectories))
        {
            var key = Path.GetFileName(Path.GetDirectoryName(configPath))!;
            if (string.IsNullOrWhiteSpace(key))
                continue;

            VehicleTemplateFile file;
            try
            {
                var json = await File.ReadAllTextAsync(configPath, cancellationToken);
                file = JsonSerializer.Deserialize<VehicleTemplateFile>(json, JsonOptions)
                    ?? throw new InvalidOperationException("Template file deserialized to null.");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to read template file {Path}; skipping.", configPath);
                continue;
            }

            var hash = ChannelMapHashProvider.GenerateHash(file.ChannelMap);
            var existing = await db.ChannelTemplates.FirstOrDefaultAsync(t => t.Key == key, cancellationToken);
            if (existing == null)
            {
                db.ChannelTemplates.Add(new ChannelTemplate
                {
                    Key = key,
                    Name = file.Name,
                    Description = file.Description,
                    Version = file.Version,
                    Author = file.Author,
                    ChannelMapJson = JsonSerializer.Serialize(file.ChannelMap, JsonOptions),
                    ChannelMapHash = hash,
                    CreatedAt = file.Created?.ToUniversalTime() ?? DateTime.UtcNow,
                });
                _logger.LogInformation("Seeded channel template '{Key}' (hash {Hash}).", key, hash[..8]);
            }
            else if (existing.ChannelMapHash != hash)
            {
                existing.Name = file.Name;
                existing.Description = file.Description;
                existing.Version = file.Version;
                existing.Author = file.Author;
                existing.ChannelMapJson = JsonSerializer.Serialize(file.ChannelMap, JsonOptions);
                existing.ChannelMapHash = hash;
                existing.UpdatedAt = DateTime.UtcNow;
                _logger.LogInformation("Updated channel template '{Key}' (hash {Hash}).", key, hash[..8]);
            }
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Applies a template to a car, replacing the car's entire channel configuration.
    /// </summary>
    public async Task ApplyTemplateAsync(int carId, int templateId, CancellationToken cancellationToken = default)
    {
        using var scope = _serviceProvider.CreateScope();
        await using var db = scope.ServiceProvider.GetRequiredService<LteCarContext>();

        var template = await db.ChannelTemplates.FirstOrDefaultAsync(t => t.Id == templateId, cancellationToken)
            ?? throw new InvalidOperationException($"Template {templateId} not found.");

        var map = JsonSerializer.Deserialize<ChannelMap>(template.ChannelMapJson, JsonOptions)
            ?? throw new InvalidOperationException($"Template {templateId} contains an invalid channel map.");

        await ChannelMapMapper.SaveToDbAsync(carId, map, db, cancellationToken);

        var car = await db.Cars.FirstOrDefaultAsync(c => c.Id == carId, cancellationToken)
            ?? throw new InvalidOperationException($"Car {carId} not found.");

        var hash = ChannelMapHashProvider.GenerateHash(map);
        car.ChannelMapHash = hash;
        await db.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Applied template '{TemplateName}' ({TemplateId}) to car {CarId} (hash {Hash}).",
            template.Name, template.Id, carId, hash[..8]);
    }

    /// <summary>
    /// Returns the deserialized channel map for a template.
    /// </summary>
    public ChannelMap? GetTemplateChannelMap(ChannelTemplate template)
    {
        try
        {
            return JsonSerializer.Deserialize<ChannelMap>(template.ChannelMapJson, JsonOptions);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to deserialize channel map for template {TemplateId}.", template.Id);
            return null;
        }
    }

    private string GetTemplateDirectory()
    {
        var candidates = new[]
        {
            Path.Combine(_hostEnvironment.ContentRootPath, "VehicleTemplates"),
            Path.Combine(Path.GetFullPath(Path.Combine(_hostEnvironment.ContentRootPath, "..")), "VehicleTemplates"),
            "/app/VehicleTemplates"
        };

        foreach (var candidate in candidates)
        {
            if (Directory.Exists(candidate))
                return candidate;
        }

        return candidates[0];
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };
}
