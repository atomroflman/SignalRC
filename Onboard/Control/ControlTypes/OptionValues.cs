using System.Globalization;
using System.Text.Json;

namespace SignalRC.Onboard.Control.ControlTypes;

/// <summary>
/// Typed access to a channel's <c>Options</c>. Values arrive as JsonElement (local store) or as plain
/// primitives (MessagePack from the server); keys are matched case-insensitively.
/// </summary>
internal static class OptionValues
{
    private static object? Find(IReadOnlyDictionary<string, object>? options, string key)
    {
        if (options == null) return null;
        if (options.TryGetValue(key, out var exact)) return exact;
        foreach (var (k, v) in options)
        {
            if (string.Equals(k, key, StringComparison.OrdinalIgnoreCase))
                return v;
        }
        return null;
    }

    public static string? GetString(IReadOnlyDictionary<string, object>? options, string key) => Find(options, key) switch
    {
        null => null,
        JsonElement { ValueKind: JsonValueKind.String } e => e.GetString(),
        JsonElement { ValueKind: JsonValueKind.Null or JsonValueKind.Undefined } => null,
        JsonElement e => e.GetRawText(),
        IFormattable f => f.ToString(null, CultureInfo.InvariantCulture),
        var v => v.ToString(),
    };

    public static double GetDouble(IReadOnlyDictionary<string, object>? options, string key, double fallback)
    {
        var value = Find(options, key);
        if (value is JsonElement { ValueKind: JsonValueKind.Number } e)
            return e.GetDouble();
        if (value is IConvertible and not string and not bool)
            return Convert.ToDouble(value, CultureInfo.InvariantCulture);
        return double.TryParse(GetString(options, key), NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
    }

    public static bool GetBool(IReadOnlyDictionary<string, object>? options, string key, bool fallback) => Find(options, key) switch
    {
        null => fallback,
        bool b => b,
        JsonElement { ValueKind: JsonValueKind.True } => true,
        JsonElement { ValueKind: JsonValueKind.False } => false,
        _ => GetString(options, key)?.Trim().ToLowerInvariant() switch
        {
            "true" or "1" or "yes" or "on" => true,
            "false" or "0" or "no" or "off" => false,
            _ => fallback,
        },
    };
}
