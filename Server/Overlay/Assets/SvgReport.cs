using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Assets;

/// <summary>Limits per asset (Shared/Overlay/svg/README.md §3, D32).</summary>
public static class SvgLimits
{
    public const int MaxRawBytes = 256 * 1024;
    public const int MaxOutputBytes = 256 * 1024;
    public const int MaxElements = 2000;
    public const int MaxDepth = 32;
    public const int MaxCoordinates = 50_000;
    public const int MaxDefinitions = 64;
    public const int MaxStopsPerGradient = 32;
    public const int MaxTextCharacters = 5000;
    public const double MaxAbsValue = 1e6;

    // Guards for the work done before the final limits can be checked; they
    // bound parsing and use expansion, not the accepted result.
    internal const int MaxRawDepth = 128;
    internal const int MaxRawElements = 40_000;
    internal const int MaxExpandedElements = 4 * MaxElements;
}

/// <summary>Report codes (Shared/Overlay/svg/README.md §6).</summary>
public static class SvgReportCodes
{
    public const string RemovedElement = "SVG_REMOVED_ELEMENT";
    public const string RemovedAttribute = "SVG_REMOVED_ATTRIBUTE";
    public const string ExternalReference = "SVG_EXTERNAL_REFERENCE";
    public const string UnsupportedCss = "SVG_UNSUPPORTED_CSS";
    public const string FontMapped = "SVG_FONT_MAPPED";
    public const string UnitConverted = "SVG_UNIT_CONVERTED";
    public const string MetadataRemoved = "SVG_METADATA_REMOVED";
    public const string RejectedDoctype = "SVG_REJECTED_DOCTYPE";
    public const string RejectedLimit = "SVG_REJECTED_LIMIT";
    public const string RejectedParse = "SVG_REJECTED_PARSE";
    public const string RejectedEmpty = "SVG_REJECTED_EMPTY";
    public const string RejectedUseCycle = "SVG_REJECTED_USE_CYCLE";
}

/// <summary>Aggregated report: one entry per code with a count and up to three distinct examples.</summary>
internal sealed class SvgReport
{
    private const int MaxExamples = 3;
    private const int MaxExampleLength = 60;

    private readonly List<(string Code, int Count, List<string> Examples)> _entries = [];

    public void Add(string code, string example)
    {
        var index = _entries.FindIndex(e => e.Code == code);
        if (index < 0)
        {
            _entries.Add((code, 0, []));
            index = _entries.Count - 1;
        }
        var entry = _entries[index];
        var text = Shorten(example);
        if (entry.Examples.Count < MaxExamples && text.Length > 0 && !entry.Examples.Contains(text)) entry.Examples.Add(text);
        _entries[index] = (code, entry.Count + 1, entry.Examples);
    }

    public bool Has(string code) => _entries.Any(e => e.Code == code);

    public JsonArray ToJson()
    {
        var list = new JsonArray();
        foreach (var (code, count, examples) in _entries)
        {
            list.Add(new JsonObject
            {
                ["code"] = code,
                ["count"] = count,
                ["examples"] = new JsonArray(examples.Select(e => (JsonNode)e).ToArray()),
            });
        }
        return list;
    }

    private static string Shorten(string value)
    {
        var flat = new string(value.Select(c => char.IsControl(c) ? ' ' : c).ToArray()).Trim();
        return flat.Length <= MaxExampleLength ? flat : flat[..(MaxExampleLength - 1)] + "…";
    }
}

/// <summary>Ends sanitizing with a rejection code.</summary>
internal sealed class SvgRejectedException(string code, string example) : Exception(example)
{
    public string Code { get; } = code;
    public string Example { get; } = example;
}
