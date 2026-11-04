using Microsoft.Extensions.DependencyInjection.Extensions;
using System.IO.Compression;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.ResponseCompression;
using SignalRC.Server.Overlay.Documents;
using SignalRC.Server.Overlay.Expressions;

namespace SignalRC.Server.Overlay;

/// <summary>Registration block of the overlay module, wired once in Program.cs.</summary>
public static partial class OverlayRegistration
{
    [GeneratedRegex(@"^/api/cars/\d+/overlay(/|$)")]
    private static partial Regex OverlayPath();

    public static IServiceCollection AddOverlay(this IServiceCollection services)
    {
        services.AddScoped<OverlayAccess>();
        services.AddScoped(sp => new OverlayService(
            sp.GetRequiredService<Data.SignalRCContext>(),
            sp.GetRequiredService<OverlayAccess>(),
            sp.GetRequiredService<ISvgAssetSanitizer>(),
            sp.GetRequiredService<IOverlayNotifier>(),
            sp.GetRequiredService<TimeProvider>(),
            sp.GetService<IExpressionAnalyzer>()));
        // AP06: formulas are checked on publish (replaces the D66 fallback warning).
        services.AddSingleton<IExpressionAnalyzer>(ExpressionAnalyzer.Instance);
        services.AddSingleton<IOverlayNotifier, HubOverlayNotifier>();
        // AP07: allowlist sanitizer; replaces the D67 placeholder.
        services.AddSingleton<ISvgAssetSanitizer, Assets.SvgAssetSanitizer>();
        services.TryAddSingleton(TimeProvider.System);
        services.AddHostedService<OverlayAssetCleanupService>();

        // D63: compressed overlay responses; gzip request bodies accepted.
        services.AddResponseCompression(options =>
        {
            options.EnableForHttps = true;
            options.Providers.Add<BrotliCompressionProvider>();
            options.Providers.Add<GzipCompressionProvider>();
            options.MimeTypes = ["application/json", "application/problem+json", "image/svg+xml"];
        });
        services.Configure<BrotliCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
        services.Configure<GzipCompressionProviderOptions>(o => o.Level = CompressionLevel.Fastest);
        services.AddRequestDecompression();
        return services;
    }

    /// <summary>Compression only for overlay endpoints; the rest of the API is unchanged.</summary>
    public static IApplicationBuilder UseOverlay(this IApplicationBuilder app) =>
        app.UseWhen(ctx => OverlayPath().IsMatch(ctx.Request.Path.Value ?? ""), branch =>
        {
            branch.UseRequestDecompression();
            branch.UseResponseCompression();
        });
}
