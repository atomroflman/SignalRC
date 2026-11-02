using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace SignalRC.Server.Overlay.Documents;

// Types of the overlay document contract v1 (Shared/Overlay/README.md).
// Documents stay JsonNode trees so that missing and null keep their JSON
// meaning; only diagnostics, context and resolved output are typed.

// --- Diagnostics (Shared/Overlay/README.md §8) ---

[JsonConverter(typeof(JsonStringEnumConverter<DiagnosticCategory>))]
public enum DiagnosticCategory
{
    [JsonStringEnumMemberName("structure")] Structure,
    [JsonStringEnumMemberName("publish")] Publish,
    [JsonStringEnumMemberName("warning")] Warning,
}

[JsonConverter(typeof(JsonStringEnumConverter<DiagnosticSeverity>))]
public enum DiagnosticSeverity
{
    [JsonStringEnumMemberName("error")] Error,
    [JsonStringEnumMemberName("warning")] Warning,
}

/// <summary>Only the applicable fields are set; without Variant the diagnostic concerns the standard.</summary>
public sealed record DiagnosticLocation
{
    public string? Variant { get; init; }
    public string? Element { get; init; }
    public string? Part { get; init; }
    public string? Property { get; init; }
    public string? Clip { get; init; }
    public int? Track { get; init; }
    public int? Keyframe { get; init; }
    public string? Container { get; init; }
    public string? Ref { get; init; }
    public string? Field { get; init; }
    public string? Limit { get; init; }
    public string? Path { get; init; }
    public int? Offset { get; init; }

    public static readonly DiagnosticLocation Empty = new();
}

public sealed record Diagnostic(
    string Code,
    DiagnosticCategory Category,
    DiagnosticSeverity Severity,
    DiagnosticLocation Location,
    string Message);

// --- Validation context ---

[JsonConverter(typeof(JsonStringEnumConverter<TelemetryDataType>))]
public enum TelemetryDataType
{
    String,
    Integer,
    Number,
    Boolean,
    LidarGrid,
}

public sealed record SourceCatalog(
    IReadOnlyDictionary<string, TelemetryDataType> Telemetry,
    IReadOnlyList<string> Outputs);

public sealed record AssetPart(string Tag, double[] Bbox);

public sealed record AssetMetadata(
    double Width,
    double Height,
    IReadOnlyDictionary<string, AssetPart> Parts,
    long? SizeBytes = null);

public sealed record ExpressionEnvironment(
    IReadOnlyDictionary<string, TelemetryDataType> Telemetry,
    IReadOnlyList<string> Outputs,
    IReadOnlyList<string> Signals);

public sealed record ExpressionDiagnostic(string Code, DiagnosticCategory Category, int Offset, string? Message = null);

public sealed record ExpressionAnalysis(IReadOnlyList<ExpressionDiagnostic> Diagnostics);

/// <summary>Port to the expression system (AP06). Optional for AP01.</summary>
public interface IExpressionAnalyzer
{
    /// <param name="expected">Kind a formula result must have, as named in expression/README.md §3.</param>
    ExpressionAnalysis Analyze(string expr, ExpressionEnvironment env, string expected);
}

public sealed record ResolveContext
{
    /// <summary>Known stream ids of the vehicle; enables the orphan check (D53).</summary>
    public IReadOnlyList<string>? Streams { get; init; }
    /// <summary>Known sources; enables source reference checks.</summary>
    public SourceCatalog? Sources { get; init; }
    /// <summary>Known assets; enables asset and part checks.</summary>
    public IReadOnlyDictionary<string, AssetMetadata>? Assets { get; init; }
    public IExpressionAnalyzer? Expressions { get; init; }

    public static readonly ResolveContext Empty = new();
}

// --- Effective configuration ---

[JsonConverter(typeof(JsonStringEnumConverter<ValueOrigin>))]
public enum ValueOrigin
{
    [JsonStringEnumMemberName("standard")] Standard,
    [JsonStringEnumMemberName("variant")] Variant,
}

public sealed class EffectiveElement
{
    public required string Id { get; init; }
    public required string Type { get; init; }
    public required ValueOrigin Origin { get; init; }
    public string? Name { get; init; }
    public required string Parent { get; init; }
    /// <summary>Set for groups only.</summary>
    public IReadOnlyList<string>? Children { get; init; }
    /// <summary>Own flag after variant override.</summary>
    public required bool Disabled { get; init; }
    /// <summary>Own flag or any ancestor disabled.</summary>
    public required bool EffectiveDisabled { get; init; }
    public required bool Locked { get; init; }
    public required bool EditorHidden { get; init; }
    public required bool LockAspect { get; init; }
    public required string OnInvalid { get; init; }
    public required JsonObject Props { get; init; }
    /// <summary>Which explicit props come from the variant.</summary>
    public required IReadOnlyDictionary<string, ValueOrigin> PropOrigins { get; init; }
    public required JsonObject Parts { get; init; }
    public string? AssetId { get; init; }
    public string? Source { get; init; }

    public JsonObject ToJson()
    {
        var o = new JsonObject
        {
            ["id"] = Id,
            ["type"] = Type,
            ["origin"] = Json.OriginName(Origin),
        };
        if (Name != null) o["name"] = Name;
        o["parent"] = Parent;
        if (Children != null) o["children"] = Json.StringArray(Children);
        o["disabled"] = Disabled;
        o["effectiveDisabled"] = EffectiveDisabled;
        o["locked"] = Locked;
        o["editorHidden"] = EditorHidden;
        o["lockAspect"] = LockAspect;
        o["onInvalid"] = OnInvalid;
        o["props"] = Props.DeepClone();
        var origins = new JsonObject();
        foreach (var (key, origin) in PropOrigins) origins[key] = Json.OriginName(origin);
        o["propOrigins"] = origins;
        o["parts"] = Parts.DeepClone();
        if (AssetId != null) o["assetId"] = AssetId;
        if (Source != null) o["source"] = Source;
        return o;
    }
}

public sealed class EffectiveClip
{
    public required string Id { get; init; }
    public required ValueOrigin Origin { get; init; }
    /// <summary>Clip data after variant overrides (durationS, trigger, tracks, …).</summary>
    public required JsonObject Clip { get; init; }
    /// <summary>Clip settings overridden by the variant, in the order of the override.</summary>
    public required List<string> Overridden { get; init; }

    public bool Disabled => Clip["disabled"]?.GetValue<bool>() ?? false;

    public JsonObject ToJson()
    {
        var o = (JsonObject)Clip.DeepClone();
        o["id"] = Id;
        o["origin"] = Json.OriginName(Origin);
        o["overridden"] = Json.StringArray(Overridden);
        return o;
    }
}

public sealed class EffectiveConfig
{
    public required string? StreamId { get; init; }
    public required JsonObject Workspace { get; init; }
    public JsonObject? RootTransform { get; init; }
    public required JsonObject Signals { get; init; }
    /// <summary>sources.telemetry of the document.</summary>
    public required JsonObject Telemetry { get; init; }
    public required IReadOnlyList<string> Root { get; init; }
    /// <summary>Elements reachable from the root, in tree order.</summary>
    public required IReadOnlyDictionary<string, EffectiveElement> Elements { get; init; }
    public required IReadOnlyDictionary<string, EffectiveClip> Clips { get; init; }

    /// <summary>Same shape as the client's EffectiveConfig.</summary>
    public JsonObject ToJson()
    {
        var o = new JsonObject
        {
            ["streamId"] = StreamId,
            ["workspace"] = Workspace.DeepClone(),
        };
        if (RootTransform != null) o["rootTransform"] = RootTransform.DeepClone();
        o["signals"] = Signals.DeepClone();
        o["sources"] = new JsonObject { ["telemetry"] = Telemetry.DeepClone() };
        o["root"] = Json.StringArray(Root);
        var elements = new JsonObject();
        foreach (var (id, element) in Elements) elements[id] = element.ToJson();
        o["elements"] = elements;
        var clips = new JsonObject();
        foreach (var (id, clip) in Clips) clips[id] = clip.ToJson();
        o["clips"] = clips;
        return o;
    }
}

public abstract record ResolveResult
{
    /// <summary>No HUD for the stream; Reason is "vehicleDisabled" or "variantDisabled".</summary>
    public sealed record None(string Reason) : ResolveResult;

    public sealed record Hud(EffectiveConfig Config) : ResolveResult;

    public const string VehicleDisabled = "vehicleDisabled";
    public const string VariantDisabled = "variantDisabled";
}
