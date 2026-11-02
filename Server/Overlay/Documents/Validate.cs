using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Documents;

// Document validation (Shared/Overlay/README.md §5–§9).
//
// Categories: structure blocks saving, publish blocks publishing and turns
// into a warning inside explicitly disabled parts (formulas and source
// references only), warning never blocks. Problems in a variant's own data are
// structure; tree problems that only appear in a variant's effective view
// (D38) are publish, so a later standard change never blocks saving.
public static partial class DocumentResolver
{
    private const int MaxElements = 500;
    private const int MaxClips = 200;
    private const int MaxFormulas = 300;
    private const long MaxAssetBytes = 10 * 1024 * 1024;

    private sealed class Collector
    {
        public readonly List<Diagnostic> List = [];

        public void Add(string code, DiagnosticCategory category, DiagnosticLocation location, string message) =>
            List.Add(new Diagnostic(code, category,
                category == DiagnosticCategory.Warning ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error, location, message));
    }

    private static bool IsDynamic(JsonNode? v) => v is JsonObject;

    /// <summary>Static checks of a prop map against the catalog.</summary>
    private static void CheckProps(Collector output, string type, JsonObject? props, DiagnosticLocation location, bool part)
    {
        foreach (var (name, value) in Json.Sorted(props))
        {
            var at = location with { Property = name };
            var def = PropertyCatalog.PropDef(type, name, part);
            if (def == null)
            {
                output.Add("OVL_PROP_UNKNOWN", DiagnosticCategory.Structure, at, $"Eigenschaft {name} gibt es für {type} nicht");
                continue;
            }
            var modes = PropertyCatalog.AllowedModes(def);
            if (value is JsonObject dynamic)
            {
                var mode = dynamic.Has("binding") ? "binding" : "rate";
                if (!modes.Contains(mode))
                {
                    output.Add("OVL_PROP_MODE_NOT_ALLOWED", DiagnosticCategory.Structure, at, $"{name} erlaubt keinen Modus {mode}");
                }
                if (dynamic.Obj("rate").Obj("wrap") is { } wrap && !(wrap.Num("min") < wrap.Num("max")))
                {
                    output.Add("OVL_PROP_INVALID_WRAP", DiagnosticCategory.Structure, at, "wrap.min muss kleiner als wrap.max sein");
                }
            }
            var literal = value is JsonObject d ? d["base"] : value;
            var problem = PropertyCatalog.CheckLiteral(def, literal);
            if (problem == LiteralProblem.Type)
            {
                output.Add("OVL_PROP_TYPE", DiagnosticCategory.Structure, at, $"Wert passt nicht zum Typ von {name}");
            }
            if (problem == LiteralProblem.Range)
            {
                output.Add("OVL_PROP_OUT_OF_RANGE", DiagnosticCategory.Structure, at, $"Wert von {name} liegt außerhalb des Bereichs");
            }
        }
    }

    private static void CheckLockAspect(Collector output, bool lockAspect, bool hasScaleY, DiagnosticLocation location)
    {
        if (lockAspect && hasScaleY)
        {
            output.Add("OVL_PROP_LOCKED_ASPECT", DiagnosticCategory.Structure, location with { Property = "scaleY" },
                "Bei gesperrtem Seitenverhältnis gibt es kein scaleY");
        }
    }

    private static void CheckElement(Collector output, JsonObject element, DiagnosticLocation location, ResolveContext ctx)
    {
        var type = element.Str("type")!;
        CheckProps(output, type, element.Obj("props"), location, false);
        CheckLockAspect(output, element.Bool("lockAspect") ?? PropertyCatalog.DefaultLockAspect(type),
            element.Obj("props").Has("scaleY"), location);
        CheckParts(output, element, element.Obj("parts"), location, ctx);
    }

    private static void CheckParts(Collector output, JsonObject element, JsonObject? parts, DiagnosticLocation location, ResolveContext ctx)
    {
        var assetId = element.Str("assetId");
        var asset = !string.IsNullOrEmpty(assetId) ? ctx.Assets?.GetValueOrDefault(assetId) : null;
        foreach (var (partId, node) in Json.Sorted(parts))
        {
            var part = node!.AsObject();
            var at = location with { Part = partId };
            if (asset != null && !asset.Parts.ContainsKey(partId))
            {
                output.Add("OVL_REF_UNKNOWN_PART", DiagnosticCategory.Structure, at, $"Teil {partId} gibt es im Asset nicht");
            }
            CheckProps(output, element.Str("type")!, part.Obj("props"), at, true);
            CheckLockAspect(output, part.Bool("lockAspect") ?? false, part.Obj("props").Has("scaleY"), at);
        }
    }

    private static void CheckOverride(Collector output, JsonObject element, JsonObject over, DiagnosticLocation location, ResolveContext ctx)
    {
        var type = element.Str("type")!;
        CheckProps(output, type, over.Obj("props"), location, false);
        var lockAspect = over.Bool("lockAspect") ?? element.Bool("lockAspect") ?? PropertyCatalog.DefaultLockAspect(type);
        CheckLockAspect(output, lockAspect, element.Obj("props").Has("scaleY") || over.Obj("props").Has("scaleY"), location);
        CheckParts(output, element, over.Obj("parts"), location, ctx);
    }

    private static void TreeDiagnostics(Collector output, List<TreeIssue> issues, string? variant)
    {
        var at = new DiagnosticLocation { Variant = variant };
        foreach (var issue in issues)
        {
            switch (issue.Kind)
            {
                case TreeIssueKind.UnknownChild:
                    output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Container = issue.Container, Ref = issue.Ref },
                        $"{issue.Container} enthält das unbekannte Element {issue.Ref}");
                    break;
                case TreeIssueKind.UnknownParent:
                    output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Element = issue.Element, Ref = issue.Ref },
                        $"Ziel {issue.Ref} für {issue.Element} ist unbekannt");
                    break;
                case TreeIssueKind.NotAGroup:
                    output.Add("OVL_STRUCT_NOT_A_GROUP", DiagnosticCategory.Structure, at with { Element = issue.Element, Ref = issue.Ref },
                        $"{issue.Ref} ist keine Gruppe");
                    break;
                case TreeIssueKind.MultipleParents:
                    output.Add("OVL_STRUCT_MULTIPLE_PARENTS", DiagnosticCategory.Structure, at with { Element = issue.Element },
                        $"{issue.Element} liegt in mehreren Containern");
                    break;
                case TreeIssueKind.Orphan:
                    output.Add("OVL_STRUCT_ORPHAN", DiagnosticCategory.Structure, at with { Element = issue.Element },
                        $"{issue.Element} liegt in keinem Container");
                    break;
                case TreeIssueKind.Cycle:
                    output.Add("OVL_STRUCT_CYCLE", variant == null ? DiagnosticCategory.Structure : DiagnosticCategory.Publish,
                        at with { Element = issue.Element }, $"{issue.Element} liegt in einem Zyklus");
                    break;
            }
        }
    }

    /// <summary>Static checks of a clip's tracks (independent of other clips).</summary>
    private static void CheckTracks(Collector output, string clipId, JsonObject clip, View view, DiagnosticLocation baseLocation)
    {
        var tracks = clip.Arr("tracks")!;
        var durationS = clip.Num("durationS")!.Value;
        for (var index = 0; index < tracks.Count; index++)
        {
            var track = tracks[index]!.AsObject();
            var at = baseLocation with { Clip = clipId, Track = index };
            var elementId = track.Str("element")!;
            var property = track.Str("property")!;
            var part = track.Str("part");
            if (!view.Elements.TryGetValue(elementId, out var entry))
            {
                output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Ref = elementId },
                    $"Spur verweist auf unbekanntes Element {elementId}");
                continue;
            }
            var def = PropertyCatalog.PropDef(entry.Type, property, part != null);
            var propAt = at with { Element = elementId, Property = property, Part = string.IsNullOrEmpty(part) ? null : part };
            if (def == null)
            {
                output.Add("OVL_PROP_UNKNOWN", DiagnosticCategory.Structure, propAt, $"Eigenschaft {property} gibt es hier nicht");
                continue;
            }
            if (!PropertyCatalog.AllowedModes(def).Contains("clip"))
            {
                output.Add("OVL_PROP_MODE_NOT_ALLOWED", DiagnosticCategory.Structure, propAt, $"{property} kann nicht animiert werden");
            }
            var keyframes = track.Arr("keyframes")!;
            for (var k = 0; k < keyframes.Count; k++)
            {
                var keyframe = keyframes[k]!.AsObject();
                var t = keyframe.Num("t")!.Value;
                var kfAt = at with { Keyframe = k };
                if (k > 0 && !(t > keyframes[k - 1]!.AsObject().Num("t")!.Value))
                {
                    output.Add("OVL_CLIP_KEYFRAME_ORDER", DiagnosticCategory.Structure, kfAt, "Keyframes müssen zeitlich streng aufsteigen");
                }
                if (t > durationS)
                {
                    output.Add("OVL_CLIP_KEYFRAME_RANGE", DiagnosticCategory.Structure, kfAt, "Keyframe liegt hinter dem Clip-Ende");
                }
                if (PropertyCatalog.CheckLiteral(def, keyframe["value"]) != LiteralProblem.None)
                {
                    output.Add("OVL_PROP_TYPE", DiagnosticCategory.Structure, kfAt with { Element = elementId, Property = property },
                        "Keyframe-Wert passt nicht zur Eigenschaft");
                }
            }
        }
    }

    private sealed record Owned(string Key, string Clip, int Track, string Element, string Property, string? Part);

    /// <summary>D12: one track per property across all clips, and none on bound or rate-driven props.</summary>
    private static List<Owned> OwnershipConflicts(List<KeyValuePair<string, JsonObject>> clips, Func<string, string?, JsonObject?> props)
    {
        var owners = new HashSet<string>();
        var conflicts = new List<Owned>();
        foreach (var (clipId, clip) in clips)
        {
            var tracks = clip.Arr("tracks")!;
            for (var index = 0; index < tracks.Count; index++)
            {
                var track = tracks[index]!.AsObject();
                var element = track.Str("element")!;
                var part = track.Str("part");
                var property = track.Str("property")!;
                var key = $"{element}\0{part ?? ""}\0{property}";
                var driven = IsDynamic(props(element, part)?[property]);
                if (owners.Contains(key) || driven) conflicts.Add(new Owned(key, clipId, index, element, property, part));
                owners.Add(key);
            }
        }
        return conflicts;
    }

    private static void ConflictDiagnostic(Collector output, Owned c, DiagnosticCategory category, string? variant = null) =>
        output.Add("OVL_CLIP_PROPERTY_CONFLICT", category, new DiagnosticLocation
        {
            Variant = variant,
            Element = c.Element,
            Property = c.Property,
            Clip = c.Clip,
            Track = c.Track,
            Part = string.IsNullOrEmpty(c.Part) ? null : c.Part,
        }, $"{c.Property} von {c.Element} wird bereits anders gesteuert");

    private static List<KeyValuePair<string, JsonObject>> Clips(JsonObject? clips) =>
        Json.Sorted(clips).Select(e => KeyValuePair.Create(e.Key, e.Value!.AsObject())).ToList();

    private static List<KeyValuePair<string, JsonObject>> EffectiveVariantClips(JsonObject doc, JsonObject variant)
    {
        var clips = new Dictionary<string, JsonObject>();
        foreach (var (id, clip) in Json.Entries(doc.Obj("clips"))) clips[id] = clip!.AsObject();
        foreach (var (id, clip) in Json.Entries(variant.Obj("addedClips"))) clips.TryAdd(id, clip!.AsObject());
        foreach (var (id, node) in Json.Entries(variant.Obj("clips")))
        {
            if (doc.Obj("clips").Obj(id) is not { } clip) continue;
            var merged = (JsonObject)clip.DeepClone();
            foreach (var (key, value) in Json.Entries(node!.AsObject())) merged[key] = Json.Clone(value);
            clips[id] = merged;
        }
        return clips.OrderBy(e => e.Key, StringComparer.Ordinal).ToList();
    }

    private sealed record Formula(string Expr, string Expected, DiagnosticLocation Location, string Key);

    /// <summary>All formulas of the document with their stored location.</summary>
    private static List<Formula> CollectFormulas(JsonObject doc)
    {
        var list = new List<Formula>();
        void FromProps(string type, JsonObject? props, DiagnosticLocation loc, bool part)
        {
            foreach (var (name, value) in Json.Sorted(props))
            {
                if (value is not JsonObject dynamic) continue;
                var def = PropertyCatalog.PropDef(type, name, part);
                var location = loc with { Property = name };
                if (dynamic.Obj("binding") is { } binding)
                {
                    list.Add(new Formula(binding.Str("expr")!, def?.Kind ?? "any", location, FormulaKey(location)));
                }
                if (dynamic.Obj("rate") is { } rate)
                {
                    list.Add(new Formula(rate.Str("expr")!, "number", location, FormulaKey(location)));
                }
            }
        }
        void FromElement(JsonObject element, JsonObject? props, JsonObject? parts, DiagnosticLocation loc)
        {
            var type = element.Str("type")!;
            FromProps(type, props, loc, false);
            foreach (var (partId, part) in Json.Sorted(parts)) FromProps(type, (part as JsonObject).Obj("props"), loc with { Part = partId }, true);
        }
        void FromClip(JsonObject clip, DiagnosticLocation loc)
        {
            if (clip.Obj("trigger") is { } trigger && trigger.Str("mode") != "auto")
            {
                var location = loc with { Field = "trigger.condition" };
                list.Add(new Formula(trigger.Str("condition")!, "bool", location, FormulaKey(location)));
            }
        }
        var elements = doc.Obj("elements");
        foreach (var (id, element) in Json.Sorted(elements))
        {
            var e = element!.AsObject();
            FromElement(e, e.Obj("props"), e.Obj("parts"), new DiagnosticLocation { Element = id });
        }
        foreach (var (id, clip) in Json.Sorted(doc.Obj("clips"))) FromClip(clip!.AsObject(), new DiagnosticLocation { Clip = id });
        foreach (var (streamId, node) in Json.Sorted(doc.Obj("variants")))
        {
            var variant = node!.AsObject();
            foreach (var (id, over) in Json.Sorted(variant.Obj("elements")))
            {
                if (elements.Obj(id) is { } element)
                {
                    FromElement(element, over!.AsObject().Obj("props"), over.AsObject().Obj("parts"), new DiagnosticLocation { Variant = streamId, Element = id });
                }
            }
            foreach (var (id, element) in Json.Sorted(variant.Obj("addedElements")))
            {
                var e = element!.AsObject();
                FromElement(e, e.Obj("props"), e.Obj("parts"), new DiagnosticLocation { Variant = streamId, Element = id });
            }
            foreach (var (id, clip) in Json.Sorted(variant.Obj("clips"))) FromClip(clip!.AsObject(), new DiagnosticLocation { Variant = streamId, Clip = id });
            foreach (var (id, clip) in Json.Sorted(variant.Obj("addedClips"))) FromClip(clip!.AsObject(), new DiagnosticLocation { Variant = streamId, Clip = id });
        }
        return list;
    }

    private static string FormulaKey(DiagnosticLocation l) =>
        string.Join('\0', l.Variant ?? "", l.Element ?? "", l.Part ?? "", l.Property ?? "", l.Clip ?? "", l.Field ?? "");

    /// <summary>
    /// Keys of formulas and LiDAR sources that are active in at least one shown
    /// view; everything else lies in explicitly disabled parts.
    /// </summary>
    private static HashSet<string> ActiveKeys(JsonObject doc)
    {
        var active = new HashSet<string>();
        if (doc.Bool("disabled") == true) return active;
        var views = new List<string?> { null };
        foreach (var (streamId, variant) in Json.Sorted(doc.Obj("variants")))
        {
            if (variant!.AsObject().Bool("disabled") != true) views.Add(streamId);
        }
        foreach (var streamId in views)
        {
            var variant = streamId == null ? null : doc.Obj("variants").Obj(streamId);
            var config = EffectiveConfig(doc, streamId);
            foreach (var element in config.Elements.Values)
            {
                if (element.EffectiveDisabled) continue;
                var elementVariant = element.Origin == ValueOrigin.Variant ? streamId : null;
                foreach (var (name, _) in element.Props)
                {
                    var fromVariant = element.PropOrigins[name] == ValueOrigin.Variant;
                    active.Add(FormulaKey(new DiagnosticLocation { Variant = fromVariant ? streamId : elementVariant, Element = element.Id, Property = name }));
                }
                foreach (var (partId, part) in element.Parts)
                {
                    foreach (var (name, _) in (part as JsonObject).Obj("props") ?? new JsonObject())
                    {
                        var fromVariant = element.Origin == ValueOrigin.Standard &&
                            variant.Obj("elements").Obj(element.Id).Obj("parts").Obj(partId).Obj("props").Has(name);
                        active.Add(FormulaKey(new DiagnosticLocation
                        {
                            Variant = fromVariant || element.Origin == ValueOrigin.Variant ? streamId : null,
                            Element = element.Id,
                            Part = partId,
                            Property = name,
                        }));
                    }
                }
                active.Add(FormulaKey(new DiagnosticLocation { Variant = elementVariant, Element = element.Id, Field = "source" }));
            }
            foreach (var clip in config.Clips.Values)
            {
                if (clip.Disabled) continue;
                var fromVariant = clip.Origin == ValueOrigin.Variant || clip.Overridden.Contains("trigger");
                active.Add(FormulaKey(new DiagnosticLocation { Variant = fromVariant ? streamId : null, Clip = clip.Id, Field = "trigger.condition" }));
            }
        }
        return active;
    }

    /// <summary>Schema, structure and publish checks of a document (any JSON value).</summary>
    public static IReadOnlyList<Diagnostic> Validate(JsonNode? input, ResolveContext? context = null)
    {
        var schema = CheckSchema(input);
        if (schema.Count > 0) return schema;
        var ctx = context ?? ResolveContext.Empty;
        var doc = input!.AsObject();
        var elements = doc.Obj("elements")!;
        var docClips = doc.Obj("clips");
        var variants = Json.Sorted(doc.Obj("variants")).Select(e => KeyValuePair.Create(e.Key, e.Value!.AsObject())).ToList();
        var output = new Collector();

        // One id namespace across standard and all added elements/clips.
        var elementIds = new HashSet<string>(Json.Keys(elements));
        var clipIds = new HashSet<string>(Json.Keys(docClips));
        foreach (var (streamId, variant) in variants)
        {
            foreach (var (id, _) in Json.Sorted(variant.Obj("addedElements")))
            {
                if (!elementIds.Add(id))
                {
                    output.Add("OVL_ID_DUPLICATE", DiagnosticCategory.Structure, new DiagnosticLocation { Variant = streamId, Element = id }, $"ID {id} ist bereits vergeben");
                }
            }
            foreach (var (id, _) in Json.Sorted(variant.Obj("addedClips")))
            {
                if (!clipIds.Add(id))
                {
                    output.Add("OVL_ID_DUPLICATE", DiagnosticCategory.Structure, new DiagnosticLocation { Variant = streamId, Clip = id }, $"ID {id} ist bereits vergeben");
                }
            }
        }

        // Standard.
        var standard = BuildView(doc);
        TreeDiagnostics(output, standard.Issues, null);
        foreach (var (id, element) in Json.Sorted(elements)) CheckElement(output, element!.AsObject(), new DiagnosticLocation { Element = id }, ctx);
        var standardClips = Clips(docClips);
        foreach (var (id, clip) in standardClips) CheckTracks(output, id, clip, standard, DiagnosticLocation.Empty);
        var standardConflicts = OwnershipConflicts(standardClips, (element, part) =>
            part != null ? elements.Obj(element).Obj("parts").Obj(part).Obj("props") : elements.Obj(element).Obj("props"));
        foreach (var c in standardConflicts) ConflictDiagnostic(output, c, DiagnosticCategory.Structure);

        // Variants.
        var standardHealthy = standard.Issues.Count == 0;
        foreach (var (streamId, variant) in variants)
        {
            var at = new DiagnosticLocation { Variant = streamId };
            if (ctx.Streams != null && !ctx.Streams.Contains(streamId))
            {
                output.Add("OVL_VARIANT_ORPHANED", DiagnosticCategory.Warning, at, $"Stream {streamId} gibt es nicht mehr");
            }
            foreach (var (id, over) in Json.Sorted(variant.Obj("elements")))
            {
                if (elements.Obj(id) is not { } element)
                {
                    output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Element = id }, $"Überschreibung für unbekanntes Element {id}");
                    continue;
                }
                CheckOverride(output, element, over!.AsObject(), at with { Element = id }, ctx);
            }
            var added = variant.Obj("addedElements");
            foreach (var (id, element) in Json.Sorted(added))
            {
                if (!elements.Has(id)) CheckElement(output, element!.AsObject(), at with { Element = id }, ctx);
            }
            bool Known(string id) => elements.Has(id) || added.Has(id);
            foreach (var (id, _) in Json.Sorted(variant.Obj("structure").Obj("parents")))
            {
                if (!Known(id)) output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Element = id }, $"Umgruppierung für unbekanntes Element {id}");
            }
            foreach (var (container, ids) in Json.Sorted(variant.Obj("structure").Obj("order")))
            {
                if (container != Root && !Known(container))
                {
                    output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Container = container }, $"Reihenfolge für unbekannten Container {container}");
                }
                foreach (var id in Json.Strings(ids!.AsArray()))
                {
                    if (!Known(id)) output.Add("OVL_REF_UNKNOWN_ELEMENT", DiagnosticCategory.Structure, at with { Container = container, Ref = id }, $"Reihenfolge nennt unbekanntes Element {id}");
                }
            }
            foreach (var (id, _) in Json.Sorted(variant.Obj("clips")))
            {
                if (!docClips.Has(id)) output.Add("OVL_REF_UNKNOWN_CLIP", DiagnosticCategory.Structure, at with { Clip = id }, $"Überschreibung für unbekannten Clip {id}");
            }
            if (!standardHealthy) continue;

            var view = BuildView(doc, variant);
            TreeDiagnostics(output, view.Issues, streamId);
            var clips = EffectiveVariantClips(doc, variant);
            foreach (var (id, clip) in clips)
            {
                var clipOverride = variant.Obj("clips").Obj(id);
                var own = variant.Obj("addedClips").Has(id) || clipOverride.Has("tracks") || clipOverride.Has("durationS");
                if (own) CheckTracks(output, id, clip, view, at);
            }
            JsonObject Props(string element, string? part)
            {
                var source = elements.Obj(element) ?? added.Obj(element);
                var over = variant.Obj("elements").Obj(element);
                var result = new JsonObject();
                var layers = part != null
                    ? new[] { source.Obj("parts").Obj(part).Obj("props"), over.Obj("parts").Obj(part).Obj("props") }
                    : new[] { source.Obj("props"), over.Obj("props") };
                foreach (var layer in layers)
                {
                    foreach (var (key, value) in Json.Entries(layer)) result[key] = Json.Clone(value);
                }
                return result;
            }
            var known0 = new HashSet<string>(standardConflicts.Select(c => $"{c.Key}\0{c.Clip}\0{c.Track}"));
            foreach (var c in OwnershipConflicts(clips, Props))
            {
                if (!known0.Contains($"{c.Key}\0{c.Clip}\0{c.Track}")) ConflictDiagnostic(output, c, DiagnosticCategory.Publish, streamId);
            }
        }

        // References to sources, assets and formulas.
        var active = ActiveKeys(doc);
        DiagnosticCategory Downgrade(string key, DiagnosticCategory category) =>
            category == DiagnosticCategory.Publish && !active.Contains(key) ? DiagnosticCategory.Warning : category;
        IEnumerable<(JsonObject Element, DiagnosticLocation Location)> AllElements()
        {
            foreach (var (id, element) in Json.Sorted(elements)) yield return (element!.AsObject(), new DiagnosticLocation { Element = id });
            foreach (var (streamId, variant) in variants)
            {
                foreach (var (id, element) in Json.Sorted(variant.Obj("addedElements")))
                {
                    yield return (element!.AsObject(), new DiagnosticLocation { Variant = streamId, Element = id });
                }
            }
        }
        if (ctx.Sources is { } sources)
        {
            foreach (var (element, loc) in AllElements())
            {
                if (element.Str("type") != "lidarWidget" || element.Str("source") is not { } source) continue;
                if (sources.Telemetry.TryGetValue(source, out var dataType) && dataType == TelemetryDataType.LidarGrid) continue;
                var location = loc with { Field = "source" };
                output.Add("OVL_REF_UNKNOWN_SOURCE", Downgrade(FormulaKey(location), DiagnosticCategory.Publish), location with { Ref = source },
                    $"LiDAR-Rasterkanal {source} gibt es nicht");
            }
            foreach (var (name, _) in Json.Sorted(doc.Obj("sources").Obj("telemetry")))
            {
                if (!sources.Telemetry.ContainsKey(name))
                {
                    output.Add("OVL_REF_UNKNOWN_SOURCE", DiagnosticCategory.Warning, new DiagnosticLocation { Field = "sources.telemetry", Ref = name },
                        $"Fristüberschreibung für unbekannten Kanal {name}");
                }
            }
        }
        if (ctx.Assets is { } assets)
        {
            foreach (var (element, loc) in AllElements())
            {
                if (element.Str("type") == "svgAsset" && element.Str("assetId") is { Length: > 0 } assetId && !assets.ContainsKey(assetId))
                {
                    output.Add("OVL_REF_UNKNOWN_ASSET", DiagnosticCategory.Publish, loc with { Ref = assetId }, "Asset ist nicht vorhanden");
                }
            }
        }
        var formulas = CollectFormulas(doc);
        if (ctx.Expressions is { } expressions)
        {
            var env = new ExpressionEnvironment(
                ctx.Sources?.Telemetry ?? new Dictionary<string, TelemetryDataType>(),
                ctx.Sources?.Outputs ?? [],
                Json.Keys(doc.Obj("signals")));
            foreach (var formula in formulas)
            {
                foreach (var d in expressions.Analyze(formula.Expr, env, formula.Expected).Diagnostics)
                {
                    output.Add(d.Code, Downgrade(formula.Key, d.Category), formula.Location with { Offset = d.Offset }, d.Message ?? d.Code);
                }
            }
        }

        // Limits (D33).
        void Limit(string name, DiagnosticLocation location, string message) =>
            output.Add("OVL_LIMIT_EXCEEDED", DiagnosticCategory.Structure, location with { Limit = name }, message);
        if (elements.Count > MaxElements) Limit("elements", DiagnosticLocation.Empty, "Mehr als 500 Elemente");
        foreach (var (streamId, variant) in variants)
        {
            var count = elements.Count + Json.Keys(variant.Obj("addedElements")).Count(id => !elements.Has(id));
            if (count > MaxElements) Limit("elements", new DiagnosticLocation { Variant = streamId }, "Mehr als 500 Elemente");
        }
        var clipCount = (docClips?.Count ?? 0) + variants.Sum(v => v.Value.Obj("addedClips")?.Count ?? 0);
        if (clipCount > MaxClips) Limit("clips", DiagnosticLocation.Empty, "Mehr als 200 Clips");
        if (formulas.Count(f => Json.JsTrim(f.Expr) != "") > MaxFormulas) Limit("formulas", DiagnosticLocation.Empty, "Mehr als 300 Formeln");
        if (ctx.Assets is { } usedAssets)
        {
            var used = new HashSet<string>();
            foreach (var (element, _) in AllElements())
            {
                if (element.Str("assetId") is { Length: > 0 } assetId) used.Add(assetId);
            }
            var bytes = used.Sum(id => usedAssets.GetValueOrDefault(id)?.SizeBytes ?? 0);
            if (bytes > MaxAssetBytes) Limit("assets", DiagnosticLocation.Empty, "Assets zusammen größer als 10 MB");
        }
        return output.List;
    }

    /// <summary>True when nothing blocks saving the draft.</summary>
    public static bool CanSave(IEnumerable<Diagnostic> diagnostics) => diagnostics.All(d => d.Category != DiagnosticCategory.Structure);

    /// <summary>True when nothing blocks publishing.</summary>
    public static bool CanPublish(IEnumerable<Diagnostic> diagnostics) => diagnostics.All(d => d.Category == DiagnosticCategory.Warning);
}
