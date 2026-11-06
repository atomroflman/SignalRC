using System.Globalization;
using System.Text.RegularExpressions;

namespace SignalRC.Onboard.Flow;

/// <summary>
/// Number conversions with the semantics of the browser flow (JavaScript), so that
/// a function behaves the same in both zones (OnboardFlow-Arbeitspakete.md T15).
/// </summary>
public static partial class JsNumber
{
    /// <summary>JavaScript <c>Number(text)</c>: empty → 0, invalid → NaN.</summary>
    public static double Parse(string? text)
    {
        if (text == null) return double.NaN;
        var t = text.Trim();
        if (t.Length == 0) return 0;
        if (t == "Infinity" || t == "+Infinity") return double.PositiveInfinity;
        if (t == "-Infinity") return double.NegativeInfinity;
        if (t.StartsWith("0x", StringComparison.OrdinalIgnoreCase))
            return long.TryParse(t[2..], NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var hex) ? hex : double.NaN;
        // Number() accepts no thousands separators, no NaN/inf words other than Infinity.
        foreach (var c in t)
            if (!(char.IsAsciiDigit(c) || c is '.' or 'e' or 'E' or '+' or '-'))
                return double.NaN;
        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : double.NaN;
    }

    /// <summary>A parameter as <c>Number(params.x ?? fallback)</c>: missing → fallback.</summary>
    public static double Param(IReadOnlyDictionary<string, string?> p, string name, double fallback) =>
        p.TryGetValue(name, out var v) && v != null ? Parse(v) : fallback;

    /// <summary>JavaScript <c>Math.round</c>: halves round up (towards +∞).</summary>
    public static double Round(double v) => Math.Floor(v + 0.5);

    /// <summary>JavaScript <c>Math.sign</c>: NaN stays NaN.</summary>
    public static double Sign(double v) => double.IsNaN(v) ? double.NaN : Math.Sign(v);

    /// <summary>
    /// Telemetry text as a flow number, like telemetryNumber in TelemetryFunction.ts:
    /// numbers as they are, true/false as 1/0, a leading number of a text ("12.5 V"), anything else 0.
    /// </summary>
    public static double Telemetry(string? raw)
    {
        var t = (raw ?? string.Empty).Trim().ToLowerInvariant();
        if (t == "true") return 1;
        if (t == "false" || t.Length == 0) return 0;
        var n = Parse(TrailingGarbage().Replace(t, string.Empty, 1));
        return double.IsFinite(n) ? n : 0;
    }

    /// <summary>A text output as an edge value: numeric text → number, otherwise 0 (edgeValue).</summary>
    public static double EdgeValue(string? text)
    {
        var n = Parse(text);
        return double.IsFinite(n) ? n : 0;
    }

    [GeneratedRegex("[^0-9eE+.-].*$")]
    private static partial Regex TrailingGarbage();
}
