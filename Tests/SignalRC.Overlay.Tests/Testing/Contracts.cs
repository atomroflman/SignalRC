using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SignalRC.Overlay.Tests.Testing;

// Test-only access to the shared contract fixtures (Shared/Overlay). The
// repository root is found by walking up to SignalRC.sln.
public static class Contracts
{
    public static readonly string RepositoryRoot = FindRoot();
    public static readonly string Root = Path.Combine(RepositoryRoot, "Shared", "Overlay");

    public static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static string FindRoot()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "SignalRC.sln"))) return dir.FullName;
        }
        throw new InvalidOperationException("SignalRC.sln not found above " + AppContext.BaseDirectory);
    }

    public static string ReadText(string relative) => File.ReadAllText(Path.Combine(Root, relative));

    public static JsonNode? ReadJson(string relative) => JsonNode.Parse(ReadText(relative));

    public static JsonNode? ToJson<T>(T value) => JsonSerializer.SerializeToNode(value, JsonOptions);

    /// <summary>
    /// True when every field of `expected` is present in `actual` with an equal
    /// (sub)value. Arrays must match completely; an expected null also matches an
    /// absent value.
    /// </summary>
    public static bool IsSubset(JsonNode? expected, JsonNode? actual)
    {
        switch (expected)
        {
            case null:
                return actual is null;
            case JsonArray list:
                return actual is JsonArray items && items.Count == list.Count && list.Select((x, i) => IsSubset(x, items[i])).All(ok => ok);
            case JsonObject fields:
                return actual is JsonObject o && fields.All(kv => IsSubset(kv.Value, o[kv.Key]));
            default:
                return actual is JsonValue && SameValue(expected, actual);
        }
    }

    /// <summary>Object.is on JSON primitives.</summary>
    private static bool SameValue(JsonNode expected, JsonNode actual)
    {
        var kind = expected.GetValueKind();
        if (kind != actual.GetValueKind()) return false;
        if (kind == JsonValueKind.Number)
        {
            var x = double.Parse(expected.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);
            var y = double.Parse(actual.ToJsonString(), System.Globalization.CultureInfo.InvariantCulture);
            return x.Equals(y) && double.IsNegative(x) == double.IsNegative(y);
        }
        return JsonNode.DeepEquals(expected, actual);
    }
}
