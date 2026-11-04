using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Server.Overlay;

/// <summary>A HUD input action as it reaches the driver's flow.</summary>
public sealed record HudInputCommand(string Input, string Action, double Value);

/// <summary>
/// D75 – a viewer's click on a clickable HUD element. The viewer names only the
/// element, the SVG part and the action; input name and value come from the
/// published document, so a viewer can neither address a non-public input nor
/// send a value the document does not allow. Interactions are not overridable
/// in variants, so an element is looked up in the standard or, when a variant
/// adds it, there (element ids are unique across the document).
/// </summary>
public static class HudInputs
{
    /// <summary>The command for the driver, or null when the click is not allowed.</summary>
    public static HudInputCommand? Resolve(JsonNode? document, string elementId, string? part, string action, double value)
    {
        var element = document?["elements"]?[elementId] as JsonObject
            ?? Json.Entries(document?["variants"] as JsonObject)
                .Select(v => v.Value?["addedElements"]?[elementId] as JsonObject)
                .FirstOrDefault(e => e != null);
        var interaction = (part == null ? element?["interaction"] : element?["parts"]?[part]?["interaction"]) as JsonObject;
        if (interaction == null || interaction["public"]?.GetValueKind() != System.Text.Json.JsonValueKind.True) return null;
        var input = Json.AsString(interaction["input"]);
        if (input == null) return null;
        var fixedValue = Json.AsDouble(interaction["value"]) ?? 1;
        return Json.AsString(interaction["kind"]) switch
        {
            "button" when action == "press" => new(input, "press", fixedValue),
            "button" when action == "release" => new(input, "release", 0),
            "toggle" when action == "toggle" => new(input, "toggle", fixedValue),
            "value" when action == "set" => new(input, "set", fixedValue),
            "slider" when action == "set" => Slider(input, interaction, value),
            _ => null,
        };
    }

    private static HudInputCommand? Slider(string input, JsonObject interaction, double value)
    {
        var min = Json.AsDouble(interaction["min"]) ?? 0;
        var max = Json.AsDouble(interaction["max"]) ?? 1;
        if (!(min < max) || !double.IsFinite(value)) return null;
        return new(input, "set", Math.Clamp(value, min, max));
    }
}

/// <summary>At most <see cref="PerSecond"/> HUD inputs per connection and second; a slider sends up to 20.</summary>
public sealed class HudInputRateLimit(TimeProvider time)
{
    public const int PerSecond = 30;
    private readonly ConcurrentDictionary<string, (long Window, int Count)> _connections = new();

    public bool Allow(string connectionId)
    {
        var window = time.GetUtcNow().ToUnixTimeSeconds();
        var entry = _connections.AddOrUpdate(connectionId, (window, 1),
            (_, e) => e.Window == window ? (window, e.Count + 1) : (window, 1));
        return entry.Count <= PerSecond;
    }

    public void Forget(string connectionId) => _connections.TryRemove(connectionId, out _);
}
