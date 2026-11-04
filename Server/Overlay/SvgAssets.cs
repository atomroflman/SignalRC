using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay;

/// <param name="Svg">Normalized output; null when rejected.</param>
/// <param name="Metadata">{ width, height, parts } as in Shared/Overlay/svg/README.md §4.</param>
/// <param name="Report">Entries { code, count, examples }.</param>
public sealed record SvgSanitizeResult(bool Accepted, string? AssetId, string? Svg, JsonObject? Metadata, JsonArray Report);

/// <summary>Port to the SVG sanitizer; implemented by Assets.SvgAssetSanitizer (AP07).</summary>
public interface ISvgAssetSanitizer
{
    /// <summary>False when no sanitizer is installed; uploads are then refused (D67).</summary>
    bool IsAvailable { get; }
    SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw);
}
