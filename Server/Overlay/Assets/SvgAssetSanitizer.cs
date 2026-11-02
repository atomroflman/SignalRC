using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>
/// AP07: server-side allowlist sanitizer (Shared/Overlay/svg/README.md §1).
/// Stateless and deterministic: the same file always yields the same asset id.
/// </summary>
public sealed class SvgAssetSanitizer(ILogger<SvgAssetSanitizer>? logger = null) : ISvgAssetSanitizer
{
    public bool IsAvailable => true;

    public SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw)
    {
        var report = new SvgReport();
        try
        {
            if (raw.Length > SvgLimits.MaxRawBytes) throw new SvgRejectedException(SvgReportCodes.RejectedLimit, $"file > {SvgLimits.MaxRawBytes / 1024} kB");
            if (raw.IsEmpty) throw new SvgRejectedException(SvgReportCodes.RejectedParse, "empty file");
            var root = SvgParser.Parse(SvgParser.Decode(raw), report);
            var output = new SvgNormalizer(root, report).Run();
            if (SvgSafetyCheck.Verify(output.Svg) is { } finding)
            {
                // Never expected: the sanitizer wrote something outside its canonical forms.
                logger?.LogError("SVG safety check rejected sanitizer output: {Finding}", finding);
                throw new SvgRejectedException(SvgReportCodes.RejectedParse, "safety check: " + finding);
            }
            var assetId = "sha256-" + Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(output.Svg)));
            var metadata = new JsonObject { ["assetId"] = assetId };
            foreach (var (key, value) in output.Metadata) metadata[key] = value?.DeepClone();
            return new SvgSanitizeResult(true, assetId, output.Svg, metadata, report.ToJson());
        }
        catch (SvgRejectedException e)
        {
            report.Add(e.Code, e.Example);
            return new SvgSanitizeResult(false, null, null, null, report.ToJson());
        }
    }
}
