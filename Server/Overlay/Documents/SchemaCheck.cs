using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace SignalRC.Server.Overlay.Documents;

// Hand-written equivalent of Shared/Overlay/schema/overlay-document.schema.json
// (D64: no runtime schema library). SchemaConformanceTests checks it against
// JsonSchema.Net. A present null is a value, never an absent key.
internal sealed partial class SchemaCheck(Action<string, string> report)
{
    [GeneratedRegex(@"^[A-Za-z0-9_-]{1,64}\z")]
    private static partial Regex Id();

    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9_]{0,63}\z")]
    private static partial Regex Signal();

    [GeneratedRegex(@"^[A-Za-z][A-Za-z0-9]{0,39}\z")]
    private static partial Regex Prop();

    [GeneratedRegex(@"^sha256-[0-9a-f]{64}\z")]
    private static partial Regex Asset();

    public static bool IsId(string s) => Id().IsMatch(s);

    private static readonly string[] Shapes = ["rect", "ellipse", "line", "arc", "text", "valueText", "linearGauge", "radialGauge"];
    private static readonly string[] CommonAttrs = ["type", "name", "disabled", "locked", "editorHidden", "lockAspect", "onInvalid", "props"];
    private static readonly string[] ClipKeys = ["name", "disabled", "durationS", "repeat", "trigger", "endState", "tracks"];
    private static readonly string[] Flags = ["disabled", "locked", "editorHidden", "lockAspect"];
    private static readonly string[] Easings = ["linear", "easeIn", "easeOut", "easeInOut", "step"];

    private static string Pointer(string path, string key) => $"{path}/{key.Replace("~", "~0").Replace("/", "~1")}";
    private static string Pointer(string path, int index) => $"{path}/{index}";

    /// <summary>Object with known keys; reports unknown and missing keys.</summary>
    private bool Object(JsonNode? v, string path, string[] allowed, string[]? required = null)
    {
        if (v is not JsonObject o)
        {
            report(path, "Objekt erwartet");
            return false;
        }
        var ok = true;
        foreach (var (k, _) in Json.Entries(o))
        {
            if (!allowed.Contains(k))
            {
                report(Pointer(path, k), "unbekanntes Feld");
                ok = false;
            }
        }
        foreach (var k in required ?? [])
        {
            if (!o.ContainsKey(k))
            {
                report(Pointer(path, k), "Pflichtfeld fehlt");
                ok = false;
            }
        }
        return ok;
    }

    private void Map(JsonNode? v, string path, Func<string, bool> key, Action<JsonNode?, string> value)
    {
        if (v is not JsonObject o)
        {
            report(path, "Objekt erwartet");
            return;
        }
        foreach (var (k, item) in Json.Entries(o))
        {
            var p = Pointer(path, k);
            if (!key(k)) report(p, "ungültiger Schlüssel");
            value(item, p);
        }
    }

    private static void Opt(JsonObject o, string key, string path, Action<JsonNode?, string> check)
    {
        if (o.TryGetPropertyValue(key, out var value)) check(value, Pointer(path, key));
    }

    private void Expect(bool cond, string path, string message)
    {
        if (!cond) report(path, message);
    }

    private void Bool(JsonNode? v, string p) => Expect(Json.IsBool(v), p, "Bool erwartet");
    private void Number(JsonNode? v, string p) => Expect(Json.IsNumber(v), p, "Zahl erwartet");
    private void DisplayName(JsonNode? v, string p) => Expect(Json.IsString(v, 100), p, "Text ≤ 100 Zeichen erwartet");
    private void Expression(JsonNode? v, string p) => Expect(Json.IsString(v, 1000), p, "Formel ≤ 1000 Zeichen erwartet");
    private void IdValue(JsonNode? v, string p) => Expect(Json.AsString(v) is { } s && Id().IsMatch(s), p, "ungültige ID");
    private void OneOf(JsonNode? v, string p, string[] values, string message) =>
        Expect(Json.AsString(v) is { } s && values.Contains(s), p, message);

    private void IdList(JsonNode? v, string p)
    {
        if (v is not JsonArray a)
        {
            report(p, "Liste erwartet");
            return;
        }
        for (var i = 0; i < a.Count; i++) IdValue(a[i], Pointer(p, i));
        Expect(a.Select(SameValueKey).Distinct().Count() == a.Count, p, "Einträge nicht eindeutig");
    }

    /// <summary>Identity for uniqueness like a JavaScript Set: primitives by value, objects and arrays by reference.</summary>
    private static object SameValueKey(JsonNode? n) => n switch
    {
        null => "null",
        JsonValue when n.GetValueKind() == JsonValueKind.Number => Json.AsDouble(n)!.Value,
        JsonValue when n.GetValueKind() == JsonValueKind.String => "s:" + n.GetValue<string>(),
        JsonValue => n.GetValue<bool>(),
        _ => n,
    };

    private void Range(JsonNode? v, string p, double min, double max, bool exclusiveMin = false, bool integer = false)
    {
        var ok = (integer ? Json.IsInteger(v) : Json.IsNumber(v)) && Json.AsDouble(v) is { } d &&
                 (exclusiveMin ? d > min : d >= min) && d <= max;
        Expect(ok, p, $"{(integer ? "Ganzzahl" : "Zahl")} im Bereich erwartet");
    }

    private void Workspace(JsonNode? v, string p)
    {
        if (!Object(v, p, ["width", "height"], ["width", "height"])) return;
        Range(v!["width"], Pointer(p, "width"), 0, 16384, true);
        Range(v["height"], Pointer(p, "height"), 0, 16384, true);
    }

    private void RootTransform(JsonNode? v, string p)
    {
        if (!Object(v, p, ["scale", "offsetX", "offsetY"], ["scale", "offsetX", "offsetY"])) return;
        Range(v!["scale"], Pointer(p, "scale"), 0, 1000, true);
        Number(v["offsetX"], Pointer(p, "offsetX"));
        Number(v["offsetY"], Pointer(p, "offsetY"));
    }

    private void SignalDefinition(JsonNode? v, string p)
    {
        if (!Object(v, p, ["label", "unit", "decimals"], ["label"])) return;
        var o = v!.AsObject();
        DisplayName(o["label"], Pointer(p, "label"));
        Opt(o, "unit", p, (u, up) => Expect(Json.IsString(u, 32), up, "Text ≤ 32 Zeichen erwartet"));
        Opt(o, "decimals", p, (d, dp) => Range(d, dp, 0, 6, false, true));
    }

    private void Sources(JsonNode? v, string p)
    {
        if (!Object(v, p, ["telemetry"])) return;
        Opt(v!.AsObject(), "telemetry", p, (t, tp) =>
            Map(t, tp, k => Json.Length(k) is >= 1 and <= 64, (s, sp) =>
            {
                if (!Object(s, sp, ["staleAfterMs"])) return;
                Opt(s!.AsObject(), "staleAfterMs", sp, (x, xp) => Range(x, xp, 500, 600000, false, true));
            }));
    }

    private void Literal(JsonNode? v, string p)
    {
        var ok = v == null || Json.IsBool(v) || Json.IsNumber(v) || Json.IsString(v, 1000);
        Expect(ok, p, "Zahl, Text ≤ 1000, Bool oder null erwartet");
    }

    private void Binding(JsonNode? v, string p)
    {
        if (!Object(v, p, ["expr", "smoothing"], ["expr"])) return;
        var o = v!.AsObject();
        Expression(o["expr"], Pointer(p, "expr"));
        Opt(o, "smoothing", p, (s, sp) =>
        {
            if (!Object(s, sp, ["timeConstantS"], ["timeConstantS"])) return;
            Range(s!["timeConstantS"], Pointer(sp, "timeConstantS"), 0, 60, true);
        });
    }

    private void Rate(JsonNode? v, string p)
    {
        if (!Object(v, p, ["expr", "wrap"], ["expr"])) return;
        var o = v!.AsObject();
        Expression(o["expr"], Pointer(p, "expr"));
        Opt(o, "wrap", p, (w, wp) =>
        {
            if (!Object(w, wp, ["min", "max"], ["min", "max"])) return;
            Number(w!["min"], Pointer(wp, "min"));
            Number(w["max"], Pointer(wp, "max"));
        });
    }

    private void PropertyValue(JsonNode? v, string p)
    {
        if (v is not JsonObject o)
        {
            Literal(v, p);
            return;
        }
        if (!Object(o, p, ["base", "binding", "rate"], ["base"])) return;
        Literal(o["base"], Pointer(p, "base"));
        Expect(o.ContainsKey("binding") != o.ContainsKey("rate"), p, "genau eines von binding oder rate erwartet");
        Opt(o, "binding", p, Binding);
        Opt(o, "rate", p, Rate);
    }

    private void PropMap(JsonNode? v, string p) => Map(v, p, k => Prop().IsMatch(k), PropertyValue);

    private void PartMap(JsonNode? v, string p) =>
        Map(v, p, k => Id().IsMatch(k), (part, pp) =>
        {
            if (!Object(part, pp, ["props", "lockAspect"])) return;
            Opt(part!.AsObject(), "props", pp, PropMap);
            Opt(part.AsObject(), "lockAspect", pp, Bool);
        });

    private void OnInvalid(JsonNode? v, string p) => OneOf(v, p, ["hold", "hide"], "hold oder hide erwartet");

    private void CommonAttributes(JsonObject v, string p)
    {
        Opt(v, "name", p, DisplayName);
        foreach (var flag in Flags) Opt(v, flag, p, Bool);
        Opt(v, "onInvalid", p, OnInvalid);
        Opt(v, "props", p, PropMap);
    }

    private void Element(JsonNode? v, string p)
    {
        if (v is not JsonObject o)
        {
            report(p, "Objekt erwartet");
            return;
        }
        var type = Json.AsString(o["type"]);
        if (type == "group")
        {
            if (!Object(o, p, [.. CommonAttrs, "children"], ["type", "children"])) return;
            IdList(o["children"], Pointer(p, "children"));
        }
        else if (type != null && Shapes.Contains(type))
        {
            if (!Object(o, p, CommonAttrs, ["type"])) return;
        }
        else if (type == "svgAsset")
        {
            if (!Object(o, p, [.. CommonAttrs, "assetId", "parts"], ["type", "assetId"])) return;
            Expect(Json.AsString(o["assetId"]) is { } id && Asset().IsMatch(id), Pointer(p, "assetId"), "ungültige assetId");
            Opt(o, "parts", p, PartMap);
        }
        else if (type == "lidarWidget")
        {
            if (!Object(o, p, [.. CommonAttrs, "source"], ["type", "source"])) return;
            Expect(Json.IsString(o["source"], 64, 1), Pointer(p, "source"), "Kanalname erwartet");
        }
        else
        {
            report(Pointer(p, "type"), "unbekannter Elementtyp");
            return;
        }
        CommonAttributes(o, p);
    }

    private void ElementMap(JsonNode? v, string p) => Map(v, p, k => Id().IsMatch(k) && k != "root", Element);

    private void Keyframe(JsonNode? v, string p)
    {
        if (!Object(v, p, ["t", "value", "easing"], ["t", "value"])) return;
        var o = v!.AsObject();
        Range(o["t"], Pointer(p, "t"), 0, double.MaxValue);
        Literal(o["value"], Pointer(p, "value"));
        Opt(o, "easing", p, (e, ep) => OneOf(e, ep, Easings, "unbekanntes Easing"));
    }

    private void Track(JsonNode? v, string p)
    {
        if (!Object(v, p, ["element", "part", "property", "keyframes"], ["element", "property", "keyframes"])) return;
        var o = v!.AsObject();
        IdValue(o["element"], Pointer(p, "element"));
        Opt(o, "part", p, IdValue);
        Expect(Json.AsString(o["property"]) is { } s && Prop().IsMatch(s), Pointer(p, "property"), "ungültiger Eigenschaftsname");
        var kp = Pointer(p, "keyframes");
        if (o["keyframes"] is not JsonArray keyframes || keyframes.Count < 1 || keyframes.Count > 500)
        {
            report(kp, "1–500 Keyframes erwartet");
            return;
        }
        for (var i = 0; i < keyframes.Count; i++) Keyframe(keyframes[i], Pointer(kp, i));
    }

    private void Trigger(JsonNode? v, string p)
    {
        if (v is not JsonObject o)
        {
            report(p, "Objekt erwartet");
            return;
        }
        switch (Json.AsString(o["mode"]))
        {
            case "auto":
                Object(o, p, ["mode"], ["mode"]);
                break;
            case "whileTrue":
                if (!Object(o, p, ["mode", "condition", "onDeactivate"], ["mode", "condition"])) return;
                Expression(o["condition"], Pointer(p, "condition"));
                Opt(o, "onDeactivate", p, (x, xp) => OneOf(x, xp, ["stop", "finish"], "stop oder finish erwartet"));
                break;
            case "pulse":
                if (!Object(o, p, ["mode", "condition", "retrigger"], ["mode", "condition"])) return;
                Expression(o["condition"], Pointer(p, "condition"));
                Opt(o, "retrigger", p, (x, xp) => OneOf(x, xp, ["restart", "ignore"], "restart oder ignore erwartet"));
                break;
            default:
                report(Pointer(p, "mode"), "unbekannter Auslöser");
                break;
        }
    }

    private void ClipSettings(JsonNode? v, string p, string[] required)
    {
        if (!Object(v, p, ClipKeys, required)) return;
        var o = v!.AsObject();
        Opt(o, "name", p, DisplayName);
        Opt(o, "disabled", p, Bool);
        Opt(o, "durationS", p, (d, dp) => Range(d, dp, 0, 3600, true));
        Opt(o, "repeat", p, (r, rp) =>
            Expect(Json.AsString(r) == "infinite" || (Json.IsInteger(r) && Json.AsDouble(r) is >= 1 and <= 10000), rp,
                "1–10000 oder infinite erwartet"));
        Opt(o, "trigger", p, Trigger);
        Opt(o, "endState", p, (e, ep) => OneOf(e, ep, ["base", "hold"], "base oder hold erwartet"));
        Opt(o, "tracks", p, (t, tp) =>
        {
            if (t is not JsonArray tracks || tracks.Count > 200)
            {
                report(tp, "höchstens 200 Spuren erwartet");
                return;
            }
            for (var i = 0; i < tracks.Count; i++) Track(tracks[i], Pointer(tp, i));
        });
    }

    private void ClipMap(JsonNode? v, string p) =>
        Map(v, p, k => Id().IsMatch(k), (c, cp) => ClipSettings(c, cp, ["durationS", "trigger", "tracks"]));

    private void ElementOverride(JsonNode? v, string p)
    {
        if (!Object(v, p, ["disabled", "locked", "editorHidden", "lockAspect", "onInvalid", "props", "parts"])) return;
        var o = v!.AsObject();
        foreach (var flag in Flags) Opt(o, flag, p, Bool);
        Opt(o, "onInvalid", p, OnInvalid);
        Opt(o, "props", p, PropMap);
        Opt(o, "parts", p, PartMap);
    }

    private void Variant(JsonNode? v, string p)
    {
        string[] keys = ["disabled", "workspace", "rootTransform", "elements", "addedElements", "structure", "clips", "addedClips"];
        if (!Object(v, p, keys)) return;
        var o = v!.AsObject();
        Opt(o, "disabled", p, Bool);
        Opt(o, "workspace", p, Workspace);
        Opt(o, "rootTransform", p, RootTransform);
        Opt(o, "elements", p, (e, ep) => Map(e, ep, k => Id().IsMatch(k), ElementOverride));
        Opt(o, "addedElements", p, ElementMap);
        Opt(o, "structure", p, (s, sp) =>
        {
            if (!Object(s, sp, ["parents", "order"])) return;
            Opt(s!.AsObject(), "parents", sp, (m, mp) => Map(m, mp, k => Id().IsMatch(k), IdValue));
            Opt(s.AsObject(), "order", sp, (m, mp) => Map(m, mp, k => Id().IsMatch(k), IdList));
        });
        Opt(o, "clips", p, (c, cp) => Map(c, cp, k => Id().IsMatch(k), (x, xp) => ClipSettings(x, xp, [])));
        Opt(o, "addedClips", p, ClipMap);
    }

    public void Document(JsonNode? v)
    {
        string[] keys = ["schemaVersion", "workspace", "rootTransform", "disabled", "signals", "sources", "elements", "children", "clips", "variants"];
        Object(v, "", keys, ["schemaVersion", "workspace", "elements", "children"]);
        if (v is not JsonObject o) return;
        Opt(o, "workspace", "", Workspace);
        Opt(o, "rootTransform", "", RootTransform);
        Opt(o, "disabled", "", Bool);
        Opt(o, "signals", "", (s, sp) => Map(s, sp, k => Signal().IsMatch(k), SignalDefinition));
        Opt(o, "sources", "", Sources);
        Opt(o, "elements", "", ElementMap);
        Opt(o, "children", "", IdList);
        Opt(o, "clips", "", ClipMap);
        Opt(o, "variants", "", (m, mp) => Map(m, mp, k => Json.Length(k) is >= 1 and <= 50, Variant));
    }
}

public static partial class DocumentResolver
{
    /// <summary>
    /// Structural check of a document. An unsupported schemaVersion is reported
    /// on its own as OVL_SCHEMA_UNSUPPORTED; every other violation as
    /// OVL_SCHEMA_INVALID with a JSON pointer.
    /// </summary>
    public static IReadOnlyList<Diagnostic> CheckSchema(JsonNode? doc)
    {
        if (doc is JsonObject o && o.TryGetPropertyValue("schemaVersion", out var version) && Json.AsDouble(version) != 1)
        {
            return
            [
                new Diagnostic("OVL_SCHEMA_UNSUPPORTED", DiagnosticCategory.Structure, DiagnosticSeverity.Error,
                    new DiagnosticLocation { Path = "/schemaVersion" },
                    $"Schema-Version {version?.ToJsonString() ?? "null"} wird nicht unterstützt"),
            ];
        }
        var diagnostics = new List<Diagnostic>();
        new SchemaCheck((path, message) => diagnostics.Add(new Diagnostic("OVL_SCHEMA_INVALID", DiagnosticCategory.Structure,
            DiagnosticSeverity.Error, new DiagnosticLocation { Path = path }, message))).Document(doc);
        return diagnostics;
    }
}
