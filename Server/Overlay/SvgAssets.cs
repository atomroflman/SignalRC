using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay;

/// <param name="Svg">Normalized output; null when rejected.</param>
/// <param name="Metadata">{ width, height, parts } as in Shared/Overlay/svg/README.md §4.</param>
/// <param name="Report">Entries { code, count, examples }.</param>
public sealed record SvgSanitizeResult(bool Accepted, string? AssetId, string? Svg, JsonObject? Metadata, JsonArray Report);

/// <summary>Port to the SVG sanitizer (AP07).</summary>
public interface ISvgAssetSanitizer
{
    /// <summary>False while no sanitizer is installed; uploads are then refused (D67).</summary>
    bool IsAvailable { get; }
    SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw);
}

/// <summary>Registered until AP07 provides the sanitizer: no unchecked SVG ever reaches the database.</summary>
public sealed class UnavailableSvgAssetSanitizer : ISvgAssetSanitizer
{
    public bool IsAvailable => false;

    public SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw) =>
        throw new InvalidOperationException("SVG import is not available yet.");
}
