using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using SignalRC.Shared.Update;

namespace SignalRC.Server.Services;

/// <summary>
/// The onboard packages the server image was built with (Server/Dockerfile puts them at
/// onboard-packages/&lt;rid&gt;.zip next to the server). Hashed once on first use; the
/// files never change while the container runs. Without the folder (dotnet run outside
/// Docker) the manifest simply lists no packages.
/// </summary>
public class OnboardPackageService
{
    private const string RuntimeConfigEntry = "SignalRC.Onboard.runtimeconfig.json";

    private readonly IServerBuildInfoService _buildInfo;
    private readonly ILogger<OnboardPackageService> _logger;
    private readonly string _packageDirectory;
    private readonly Lazy<Dictionary<string, (string Path, OnboardPackageInfo Info)>> _packages;

    public OnboardPackageService(IServerBuildInfoService buildInfo, IConfiguration configuration, ILogger<OnboardPackageService> logger)
    {
        _buildInfo = buildInfo;
        _logger = logger;
        _packageDirectory = configuration.GetValue<string>("OnboardPackages:Path")
            ?? Path.Combine(AppContext.BaseDirectory, "onboard-packages");
        _packages = new Lazy<Dictionary<string, (string, OnboardPackageInfo)>>(LoadPackages);
    }

    public OnboardPackageManifest GetManifest()
    {
        var build = _buildInfo.GetBuildInfo();
        return new OnboardPackageManifest
        {
            Branch = build.Branch,
            Commit = build.Commit,
            Packages = _packages.Value.ToDictionary(kv => kv.Key, kv => kv.Value.Info),
        };
    }

    /// <summary>Path of the package for <paramref name="rid"/>; only runtime identifiers from the manifest resolve.</summary>
    public bool TryGetPackagePath(string rid, out string path)
    {
        path = string.Empty;
        if (!_packages.Value.TryGetValue(rid, out var package)) return false;
        path = package.Path;
        return true;
    }

    private Dictionary<string, (string, OnboardPackageInfo)> LoadPackages()
    {
        var packages = new Dictionary<string, (string, OnboardPackageInfo)>(StringComparer.OrdinalIgnoreCase);
        if (!Directory.Exists(_packageDirectory))
        {
            _logger.LogInformation("No onboard packages at {Directory}; onboard self-update is unavailable", _packageDirectory);
            return packages;
        }

        foreach (var file in Directory.EnumerateFiles(_packageDirectory, "*.zip"))
        {
            var rid = Path.GetFileNameWithoutExtension(file);
            try
            {
                string sha256;
                using (var stream = File.OpenRead(file))
                    sha256 = Convert.ToHexStringLower(SHA256.HashData(stream));
                var info = new OnboardPackageInfo
                {
                    Url = $"/api/onboard/packages/{rid}",
                    Sha256 = sha256,
                    Size = new FileInfo(file).Length,
                    Framework = ReadFrameworkVersion(file),
                };
                packages[rid] = (file, info);
                _logger.LogInformation("Onboard package {Rid}: {Size} bytes, sha256 {Sha256}, framework {Framework}",
                    rid, info.Size, info.Sha256, info.Framework ?? "?");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Onboard package {File} could not be read and is not offered", file);
            }
        }
        return packages;
    }

    private static string? ReadFrameworkVersion(string zipPath)
    {
        using var zip = ZipFile.OpenRead(zipPath);
        var entry = zip.GetEntry(RuntimeConfigEntry);
        if (entry == null) return null;
        using var stream = entry.Open();
        using var document = JsonDocument.Parse(stream);
        if (!document.RootElement.TryGetProperty("runtimeOptions", out var options)) return null;
        if (options.TryGetProperty("framework", out var framework))
            return framework.TryGetProperty("version", out var version) ? version.GetString() : null;
        if (options.TryGetProperty("frameworks", out var frameworks))
        {
            foreach (var item in frameworks.EnumerateArray())
            {
                if (item.TryGetProperty("name", out var name) && name.GetString() == "Microsoft.NETCore.App"
                    && item.TryGetProperty("version", out var version))
                    return version.GetString();
            }
        }
        return null;
    }
}
