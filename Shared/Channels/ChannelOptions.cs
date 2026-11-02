using System.Collections;
using System.Text.Json;

namespace SignalRC.Shared.Channels;

/// <summary>
/// Channel options as plain CLR values (string, long, double, bool, null,
/// List&lt;object?&gt;, Dictionary&lt;string, object?&gt;). Only these survive the
/// SignalR MessagePack protocol: a JsonElement goes over the wire as an empty map.
/// JSON output of plain values matches the stored JSON.
/// </summary>
public static class ChannelOptions
{
    /// <summary>Parses stored options JSON. Invalid or non-object JSON gives an empty map.</summary>
    public static Dictionary<string, object> FromJson(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new();
        try
        {
            using var doc = JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == JsonValueKind.Object
                ? (Dictionary<string, object>)ToPlain(doc.RootElement)!
                : new();
        }
        catch (JsonException)
        {
            return new();
        }
    }

    /// <summary>Copy of the options with every value converted to a plain CLR value.</summary>
    public static Dictionary<string, object> Normalize(IDictionary<string, object>? options)
    {
        var result = new Dictionary<string, object>();
        if (options == null) return result;
        foreach (var kv in options) result[kv.Key] = Normalize(kv.Value)!;
        return result;
    }

    /// <summary>Normalizes the options of every item in place (received over MessagePack).</summary>
    public static void Normalize(ChannelMap map)
    {
        foreach (var item in map.PinManagers?.Values ?? Enumerable.Empty<PinManagerMapItem>()) item.Options = Normalize(item.Options);
        foreach (var item in map.ControlChannels?.Values ?? Enumerable.Empty<ControlChannelMapItem>()) item.Options = Normalize(item.Options);
        foreach (var item in map.TelemetryChannels?.Values ?? Enumerable.Empty<TelemetryChannelMapItem>()) item.Options = Normalize(item.Options);
        foreach (var item in map.VideoStreams?.Values ?? Enumerable.Empty<VideoStreamMapItem>()) item.Options = Normalize(item.Options);
    }

    /// <summary>
    /// JsonElement, MessagePack maps (Dictionary&lt;object, object&gt;) and arrays become plain
    /// values; primitives stay as they are.
    /// </summary>
    public static object? Normalize(object? value) => value switch
    {
        null => null,
        JsonElement e => ToPlain(e),
        string or bool => value,
        IDictionary d => NormalizeMap(d),
        IEnumerable e => e.Cast<object?>().Select(Normalize).ToList(),
        _ => value,
    };

    public static object? ToPlain(JsonElement e) => e.ValueKind switch
    {
        JsonValueKind.String => e.GetString(),
        JsonValueKind.Number => e.TryGetInt64(out var l) ? l : e.GetDouble(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Array => e.EnumerateArray().Select(ToPlain).ToList(),
        JsonValueKind.Object => ObjectToPlain(e),
        _ => null,
    };

    private static Dictionary<string, object> ObjectToPlain(JsonElement e)
    {
        var result = new Dictionary<string, object>();
        foreach (var p in e.EnumerateObject()) result[p.Name] = ToPlain(p.Value)!;
        return result;
    }

    private static Dictionary<string, object> NormalizeMap(IDictionary d)
    {
        var result = new Dictionary<string, object>();
        foreach (DictionaryEntry entry in d)
        {
            result[Convert.ToString(entry.Key, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty] = Normalize(entry.Value)!;
        }
        return result;
    }
}
