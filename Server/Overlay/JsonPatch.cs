using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay;

/// <summary>
/// The add/remove/replace subset of RFC 6902 used by the overlay autosave
/// (Shared/Overlay/api/README.md §3). Operations apply in order to a copy; any
/// failure rejects the whole patch.
/// </summary>
public static class JsonPatch
{
    public sealed class PatchException(string message) : Exception(message);

    public static JsonNode Apply(JsonNode document, JsonArray patch)
    {
        JsonNode root = document.DeepClone();
        foreach (var item in patch)
        {
            if (item is not JsonObject op) throw new PatchException("operation must be an object");
            var name = (op["op"] as JsonValue)?.TryGetValue<string>(out var s) == true ? s : null;
            var path = (op["path"] as JsonValue)?.TryGetValue<string>(out var p) == true ? p : null;
            if (path == null) throw new PatchException("path missing");
            switch (name)
            {
                case "add":
                    root = Set(root, Parse(path), Value(op), insert: true);
                    break;
                case "replace":
                    root = Set(root, Parse(path), Value(op), insert: false);
                    break;
                case "remove":
                    Remove(root, Parse(path));
                    break;
                default:
                    throw new PatchException($"unsupported op {name}");
            }
        }
        return root;
    }

    private static JsonNode? Value(JsonObject op)
    {
        if (!op.ContainsKey("value")) throw new PatchException("value missing");
        return op["value"]?.DeepClone();
    }

    private static List<string> Parse(string pointer)
    {
        if (pointer.Length == 0) return [];
        if (pointer[0] != '/') throw new PatchException($"invalid pointer {pointer}");
        return pointer[1..].Split('/').Select(t => t.Replace("~1", "/").Replace("~0", "~")).ToList();
    }

    private static JsonNode Parent(JsonNode root, List<string> tokens)
    {
        var node = root;
        foreach (var token in tokens.Take(tokens.Count - 1))
        {
            node = node switch
            {
                JsonObject o when o.TryGetPropertyValue(token, out var child) && child != null => child,
                JsonArray a when Index(a, token, allowEnd: false) is var i => a[i] ?? throw new PatchException("null in path"),
                _ => throw new PatchException($"path segment {token} not found"),
            };
        }
        return node;
    }

    private static int Index(JsonArray array, string token, bool allowEnd)
    {
        if (allowEnd && token == "-") return array.Count;
        if (token.Length == 0 || (token.Length > 1 && token[0] == '0') || !token.All(char.IsAsciiDigit)
            || !int.TryParse(token, out var index))
        {
            throw new PatchException($"invalid array index {token}");
        }
        var max = allowEnd ? array.Count : array.Count - 1;
        if (index > max) throw new PatchException($"array index {token} out of range");
        return index;
    }

    private static JsonNode Set(JsonNode root, List<string> tokens, JsonNode? value, bool insert)
    {
        if (tokens.Count == 0) return value ?? throw new PatchException("document cannot be null");
        var parent = Parent(root, tokens);
        var last = tokens[^1];
        switch (parent)
        {
            case JsonObject o:
                if (!insert && !o.ContainsKey(last)) throw new PatchException($"{last} not found");
                o[last] = value;
                break;
            case JsonArray a when insert:
                a.Insert(Index(a, last, allowEnd: true), value);
                break;
            case JsonArray a:
                a[Index(a, last, allowEnd: false)] = value;
                break;
            default:
                throw new PatchException("parent is not a container");
        }
        return root;
    }

    private static void Remove(JsonNode root, List<string> tokens)
    {
        if (tokens.Count == 0) throw new PatchException("cannot remove the document");
        var parent = Parent(root, tokens);
        var last = tokens[^1];
        switch (parent)
        {
            case JsonObject o when o.ContainsKey(last):
                o.Remove(last);
                break;
            case JsonArray a:
                a.RemoveAt(Index(a, last, allowEnd: false));
                break;
            default:
                throw new PatchException($"{last} not found");
        }
    }
}
