using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SignalRC.Server.Overlay.Documents;

// Typed access to Shared/Overlay/catalog/property-catalog.json, embedded into
// the assembly (SignalRC.Server.csproj), so server and client read one file.

public sealed record KindDefinition(
    string ValueType,
    bool? Integer,
    double? Min,
    double? Max,
    bool? Clamp,
    int? MaxLength,
    string? Format,
    string Interpolation,
    IReadOnlyList<string> Modes);

public sealed record PropertyDefinition(
    string Kind,
    JsonNode? Default,
    double? Min,
    double? Max,
    bool? Integer,
    IReadOnlyList<JsonNode>? Values,
    IReadOnlyList<string>? Modes,
    string? AbsentWhen);

public sealed record TypeDefinition(
    IReadOnlyDictionary<string, PropertyDefinition> Props,
    IReadOnlyList<string>? PartProps,
    IReadOnlyDictionary<string, PropertyDefinition>? PartPropDefs);

public enum LiteralProblem
{
    None,
    Type,
    Range,
}

public static partial class PropertyCatalog
{
    public const string ResourceName = "SignalRC.Overlay.property-catalog.json";

    public static int CatalogVersion { get; }
    public static IReadOnlyDictionary<string, KindDefinition> Kinds { get; }
    public static IReadOnlyDictionary<string, PropertyDefinition> Common { get; }
    public static IReadOnlyDictionary<string, TypeDefinition> Types { get; }
    public static IReadOnlyList<string> ElementTypes { get; }

    static PropertyCatalog()
    {
        using var stream = typeof(PropertyCatalog).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidOperationException($"Embedded resource {ResourceName} missing");
        var root = JsonNode.Parse(stream)!.AsObject();
        CatalogVersion = root["catalogVersion"]!.GetValue<int>();
        Kinds = root.Obj("kinds")!.ToDictionary(e => e.Key, e => ReadKind(e.Value!.AsObject()));
        Common = ReadProps(root.Obj("common"))!;
        Types = root.Obj("types")!.ToDictionary(e => e.Key, e =>
        {
            var t = e.Value!.AsObject();
            return new TypeDefinition(ReadProps(t.Obj("props"))!, t.Arr("partProps") is { } pp ? Json.Strings(pp) : null, ReadProps(t.Obj("partPropDefs")));
        });
        ElementTypes = Types.Keys.ToList();
    }

    private static KindDefinition ReadKind(JsonObject o) => new(
        o.Str("valueType")!, o.Bool("integer"), o.Num("min"), o.Num("max"), o.Bool("clamp"),
        o.Num("maxLength") is { } m ? (int)m : null, o.Str("format"), o.Str("interpolation")!, Json.Strings(o.Arr("modes")));

    private static Dictionary<string, PropertyDefinition>? ReadProps(JsonObject? o) => o?.ToDictionary(e => e.Key, e =>
    {
        var p = e.Value!.AsObject();
        return new PropertyDefinition(
            p.Str("kind")!, Json.Clone(p["default"]), p.Num("min"), p.Num("max"), p.Bool("integer"),
            p.Arr("values")?.Select(v => v!.DeepClone()).ToList(),
            p.Arr("modes") is { } modes ? Json.Strings(modes) : null,
            p.Str("absentWhen"));
    });

    /// <summary>Definition of a property of an element type, or of an svgAsset part.</summary>
    public static PropertyDefinition? PropDef(string type, string name, bool part = false)
    {
        if (!Types.TryGetValue(type, out var typeDef)) return null;
        if (part)
        {
            if (typeDef.PartProps == null || !typeDef.PartProps.Contains(name)) return null;
            if (typeDef.PartPropDefs != null && typeDef.PartPropDefs.TryGetValue(name, out var partDef)) return partDef;
            return Common.GetValueOrDefault(name);
        }
        return typeDef.Props.TryGetValue(name, out var def) ? def : Common.GetValueOrDefault(name);
    }

    public static KindDefinition KindDef(PropertyDefinition def) => Kinds[def.Kind];

    public static IReadOnlyList<string> AllowedModes(PropertyDefinition def) => def.Modes ?? KindDef(def).Modes;

    /// <summary>lockAspect default per D02: groups and SVG assets scale proportionally.</summary>
    public static bool DefaultLockAspect(string? type) => type is "group" or "svgAsset";

    [GeneratedRegex(@"^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|none)\z")]
    private static partial Regex Color();

    /// <summary>Checks a static value (null = JSON null) against a property definition.</summary>
    public static LiteralProblem CheckLiteral(PropertyDefinition def, JsonNode? value)
    {
        var kind = KindDef(def);
        if (value == null) return kind.ValueType == "any" ? LiteralProblem.None : LiteralProblem.Type;
        switch (kind.ValueType)
        {
            case "number":
            {
                if (!Json.IsNumber(value)) return LiteralProblem.Type;
                var number = Json.AsDouble(value)!.Value;
                if ((def.Integer ?? kind.Integer ?? false) && !Json.IsInteger(value)) return LiteralProblem.Type;
                if (def.Values != null && !def.Values.Any(v => Json.AsDouble(v) == number)) return LiteralProblem.Range;
                var min = def.Min ?? kind.Min;
                var max = def.Max ?? kind.Max;
                if (min != null && number < min) return LiteralProblem.Range;
                if (max != null && number > max) return LiteralProblem.Range;
                return LiteralProblem.None;
            }
            case "boolean":
                return Json.IsBool(value) ? LiteralProblem.None : LiteralProblem.Type;
            case "string":
            {
                if (Json.AsString(value) is not { } text) return LiteralProblem.Type;
                if (kind.Format == "color" && !Color().IsMatch(text)) return LiteralProblem.Type;
                if (def.Values != null && !def.Values.Any(v => Json.AsString(v) == text)) return LiteralProblem.Range;
                return LiteralProblem.None;
            }
            default:
                return LiteralProblem.None;
        }
    }

    /// <summary>Expected formula result kind for a property (expression/README.md §3).</summary>
    public static string ExpectedKind(PropertyDefinition def) => def.Kind;
}
