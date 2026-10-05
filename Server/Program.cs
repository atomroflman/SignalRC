using LteCar.Server;
using LteCar.Server.Configuration;
using LteCar.Server.Data;
using LteCar.Server.Extensions;
using LteCar.Server.Hubs;
using LteCar.Server.Services;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.DataProtection;

var builder = WebApplication.CreateBuilder(args);
builder.Configuration
    .AddJsonFile("appSettings.json")
    .AddEnvironmentVariables()
    .AddCommandLine(args)
    .AddUserSecrets<Program>();

builder.Logging.AddConsole()
    .AddConfiguration(builder.Configuration.GetSection("Logging"));

// Configure application configuration
builder.Services.AddApplicationConfiguration(builder.Configuration);
var idSalt = builder.Configuration.GetValue<string>("IdSalt") ?? Guid.NewGuid().ToString();
var idAlphabet = builder.Configuration.GetValue<string>("IdAlphabet") ?? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
var transferAlphabet = builder.Configuration.GetValue<string>("SessionTransferAlphabet") ?? "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
while (idSalt.Length < idAlphabet.Length || idSalt.Length < transferAlphabet.Length)
{
    idSalt += idSalt;
}
var resolvedAlphabet = new string(idAlphabet
    .Distinct()
    .Zip(idSalt)
    .OrderBy(x => x.Second)
    .Select(x => x.First)
    .ToArray());
var transferResolvedAlphabet = new string(transferAlphabet
    .Distinct()
    .Zip(idSalt)
    .OrderBy(x => x.Second)
    .Select(x => x.First)
    .ToArray());
var sqids = new Sqids.SqidsEncoder<long>(new Sqids.SqidsOptions
{
    Alphabet = resolvedAlphabet,
    MinLength = 16
});
var transferSqids = new Sqids.SqidsEncoder<long>(new Sqids.SqidsOptions
{
    Alphabet = transferResolvedAlphabet,
    MinLength = 8
});
builder.Services.AddSingleton(sqids);
builder.Services.AddKeyedSingleton("transfer", transferSqids);

builder.Services.AddSingleton<VideoStreamReceiverService>();
builder.Services.AddSingleton<ActiveVideoStreamViewerRegistry>();
builder.Services.AddSingleton<CarConnectionStore>();
builder.Services.AddSingleton<AvailableTypesRegistry>();
builder.Services.AddSingleton<IServerBuildInfoService, ServerBuildInfoService>();
builder.Services.AddSingleton<IOnboardInstallScriptService, OnboardInstallScriptService>();
builder.Services.AddSingleton<ChannelTemplateService>();
builder.Services.AddDbContext<LteCarContext>((serviceProvider, options) =>
{
    var configService = serviceProvider.GetRequiredService<IConfigurationService>();
    options.UseNpgsql(configService.DefaultConnectionString, opt =>
    {
        opt.EnableRetryOnFailure(5, TimeSpan.FromSeconds(10), null);
    });
});

builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddSignalR()
    .AddMessagePackProtocol()
    .AddJsonProtocol();

var dataProtectionKeysPath = Path.Combine(Directory.GetCurrentDirectory(), "DataProtectionKeys");
Directory.CreateDirectory(dataProtectionKeysPath);
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo(dataProtectionKeysPath))
    .SetApplicationName("LteCar.Server")
    .SetDefaultKeyLifetime(TimeSpan.FromDays(90));
builder.Services.AddAuthentication("cookie")
    .AddCookie("cookie", options =>
    {
        options.Cookie.Name = "LteCarAuth";
        options.LoginPath = "/";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.IsEssential = true;
        options.Cookie.MaxAge = TimeSpan.FromDays(3650);
        options.SlidingExpiration = false;
        options.Events.OnRedirectToLogin = ctx =>
        {
            ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return Task.CompletedTask;
        };
    });

// builder.Services.AddUserCleanupService(); // TODO: Implement UserCleanupService

var app = builder.Build();
var configuration = app.Configuration;
var logger = app.Services.GetRequiredService<ILogger<Program>>();
ApplyDatabaseMigrations(app.Services, logger);
await SeedChannelTemplatesAsync(app.Services, logger);

app.Use(async(ctx, next) => {
    try
    {
        logger.LogDebug($"{ctx.Request.Method} {ctx.Request.Path}");
        logger.LogTrace($"Request: {string.Join(", ", ctx.Request.Headers.Select(h => $"{h.Key}: {h.Value}"))}");
        await next();
        logger.LogDebug($"{ctx.Response.StatusCode}");
        logger.LogTrace($"Response: {string.Join(", ", ctx.Response.Headers.Select(h => $"{h.Key}: {h.Value}"))}");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "GLOBAL EXCEPTION HANDLER: Unhandled exception in request pipeline for {Method} {Path}", ctx.Request.Method, ctx.Request.Path);
        throw;
    }
});

if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}

app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHub<CarConnectionHub>(HubPaths.CarConnectionHub);
app.MapHub<UserChannelHub>(HubPaths.UserChannelHub);
app.MapHub<CarBashHub>(HubPaths.CarBashHub);

// Validate configuration during startup
app.Services.ValidateConfiguration();

app.Run();

static async Task SeedChannelTemplatesAsync(IServiceProvider services, ILogger logger)
{
    try
    {
        using var scope = services.CreateScope();
        var templateService = scope.ServiceProvider.GetRequiredService<ChannelTemplateService>();
        await templateService.SeedAsync();
        logger.LogInformation("Channel templates seeded successfully.");
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "Failed to seed channel templates.");
    }
}

static void ApplyDatabaseMigrations(IServiceProvider services, ILogger logger)
{
    const int maxAttempts = 10;
    var delay = TimeSpan.FromSeconds(5);

    for (var attempt = 1; attempt <= maxAttempts; attempt++)
    {
        try
        {
            using var scope = services.CreateScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<LteCarContext>();
            dbContext.Database.Migrate();
            logger.LogInformation("Database migrations applied successfully.");
            return;
        }
        catch (Exception ex) when (attempt < maxAttempts)
        {
            logger.LogWarning(ex,
                "Database migration attempt {Attempt} of {MaxAttempts} failed. Retrying in {DelaySeconds} seconds.",
                attempt,
                maxAttempts,
                delay.TotalSeconds);
            Thread.Sleep(delay);
        }
    }

    using var finalScope = services.CreateScope();
    var finalDbContext = finalScope.ServiceProvider.GetRequiredService<LteCarContext>();
    finalDbContext.Database.Migrate();
}