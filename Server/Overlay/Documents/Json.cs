using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Documents;

/// <summary>
/// JSON helpers with JavaScript semantics, so results match the client
/// implementation: key order, number checks, code point lengths, trimming.
/// </summary>
internal static class Json
{
    /// <summary>
    /// Entries in JavaScript property order: array-index keys ascending, then
    /// the rest in insertion order. Diagnostics and tree order depend on it.
    /// </summary>
    public static List<KeyValuePair<string, JsonNode?>> Entries(JsonObject? o)
    {
        if (o == null) return [];
        var indexKeys = new List<(uint Index, KeyValuePair<string, JsonNode?> Entry)>();
        var others = new List<KeyValuePair<string, JsonNode?>>();
        foreach (var entry in o)
        {
            if (IsArrayIndex(entry.Key, out var index)) indexKeys.Add((index, entry));
            else others.Add(entry);
        }
        if (indexKeys.Count == 0) return others;
        return indexKeys.OrderBy(e => e.Index).Select(e => e.Entry).Concat(others).ToList();
    }

    public static List<string> Keys(JsonObject? o) => Entries(o).Select(e => e.Key).ToList();

    /// <summary>Entries sorted by key in ordinal (UTF-16 code unit) order.</summary>
    public static List<KeyValuePair<string, JsonNode?>> Sorted(JsonObject? o) =>
        o == null ? [] : o.OrderBy(e => e.Key, StringComparer.Ordinal).ToList();

    private static bool IsArrayIndex(string key, out uint index)
    {
        index = 0;
        if (key.Length == 0 || key.Length > 10 || (key.Length > 1 && key[0] == '0')) return false;
        foreach (var c in key)
        {
            if (c < '0' || c > '9') return false;
        }
        return uint.TryParse(key, NumberStyles.None, CultureInfo.InvariantCulture, out index) && index != uint.MaxValue;
    }

    public static bool IsObject(JsonNode? v) => v is JsonObject;
    public static bool IsArray(JsonNode? v) => v is JsonArray;

    public static bool IsBool(JsonNode? v) =>
        v is JsonValue && v.GetValueKind() is JsonValueKind.True or JsonValueKind.False;

    public static bool IsStringValue(JsonNode? v) => v is JsonValue && v.GetValueKind() == JsonValueKind.String;

    public static string? AsString(JsonNode? v) => IsStringValue(v) ? v!.GetValue<string>() : null;

    /// <summary>Numeric value with JavaScript precision; overflowing literals become infinite.</summary>
    public static double? AsDouble(JsonNode? v)
    {
        if (v is not JsonValue || v.GetValueKind() != JsonValueKind.Number) return null;
        return double.Parse(v.ToJsonString(), NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    public static bool IsNumber(JsonNode? v) => AsDouble(v) is { } d && double.IsFinite(d);

    /// <summary>Mathematically integral, independent of the notation (1.0 counts).</summary>
    public static bool IsInteger(JsonNode? v) => AsDouble(v) is { } d && double.IsFinite(d) && Math.Floor(d) == d;

    /// <summary>JSON Schema string lengths count code points, not UTF-16 units.</summary>
    public static int Length(string s)
    {
        var n = 0;
        for (var i = 0; i < s.Length; i++)
        {
            if (char.IsHighSurrogate(s[i]) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) i++;
            n++;
        }
        return n;
    }

    public static bool IsString(JsonNode? v, int max, int min = 0) =>
        AsString(v) is { } s && Length(s) >= min && Length(s) <= max;

    // ECMAScript WhiteSpace and LineTerminator, as removed by String.prototype.trim.
    private static readonly char[] JsWhitespace =
    [
        '\t', '\n', '\v', '\f', '\r', ' ', '\u00A0', '\u1680',
        '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007', '\u2008', '\u2009', '\u200A',
        '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
    ];

    public static string JsTrim(string s) => s.Trim(JsWhitespace);

    // --- Access to documents that passed the schema check ---

    public static JsonObject? Obj(this JsonObject? o, string key) => o?[key] as JsonObject;
    public static JsonArray? Arr(this JsonObject? o, string key) => o?[key] as JsonArray;
    public static string? Str(this JsonObject? o, string key) => AsString(o?[key]);
    public static bool? Bool(this JsonObject? o, string key) => IsBool(o?[key]) ? o![key]!.GetValue<bool>() : null;
    public static double? Num(this JsonObject? o, string key) => AsDouble(o?[key]);

    /// <summary>Key present, even with a null value (a present null is a value in JSON).</summary>
    public static bool Has(this JsonObject? o, string key) => o != null && o.ContainsKey(key);

    public static List<string> Strings(JsonArray? a) => a == null ? [] : a.Select(n => n!.GetValue<string>()).ToList();

    public static JsonArray StringArray(IEnumerable<string> items) => new(items.Select(i => (JsonNode?)JsonValue.Create(i)).ToArray());

    public static JsonNode? Clone(JsonNode? n) => n?.DeepClone();

    public static string OriginName(ValueOrigin origin) => origin == ValueOrigin.Variant ? "variant" : "standard";
}
