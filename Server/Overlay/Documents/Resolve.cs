using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Documents;

// Variant resolution (Shared/Overlay/README.md §7). Documents must have
// passed CheckSchema; map lookups are own keys only.

internal enum TreeIssueKind
{
    UnknownChild,
    MultipleParents,
    Orphan,
    Cycle,
    UnknownParent,
    NotAGroup,
}

internal sealed record TreeIssue(TreeIssueKind Kind, string? Element = null, string? Container = null, string? Ref = null);

internal sealed record ViewEntry(JsonObject Element, ValueOrigin Origin)
{
    public string Type => Element.Str("type")!;
}

internal sealed class View
{
    public required OrderedDictionary<string, ViewEntry> Elements { get; init; }
    public required Dictionary<string, string> Parent { get; init; }
    public required Dictionary<string, List<string>> Children { get; init; }
    /// <summary>Elements reachable from the root, in tree order.</summary>
    public required List<string> Reachable { get; init; }
    public required List<TreeIssue> Issues { get; init; }
}

public static partial class DocumentResolver
{
    public const string Root = "root";

    /// <summary>Builds the effective tree of the standard (variant null) or of a variant.</summary>
    internal static View BuildView(JsonObject doc, JsonObject? variant = null)
    {
        var elements = new OrderedDictionary<string, ViewEntry>();
        foreach (var (id, element) in Json.Entries(doc.Obj("elements"))) elements[id] = new ViewEntry(element!.AsObject(), ValueOrigin.Standard);
        foreach (var (id, element) in Json.Entries(variant.Obj("addedElements")))
        {
            elements.TryAdd(id, new ViewEntry(element!.AsObject(), ValueOrigin.Variant));
        }
        var issues = new List<TreeIssue>();
        bool IsContainer(string id) => id == Root || (elements.TryGetValue(id, out var e) && e.Type == "group");

        // Declared containment from the children arrays.
        var declaredChildren = new Dictionary<string, List<string>>();
        var declaredParents = new Dictionary<string, List<string>>();
        void Declare(string container, List<string> list)
        {
            var known = new List<string>();
            foreach (var child in list)
            {
                if (!elements.ContainsKey(child))
                {
                    issues.Add(new TreeIssue(TreeIssueKind.UnknownChild, Container: container, Ref: child));
                    continue;
                }
                known.Add(child);
                if (!declaredParents.TryGetValue(child, out var parents)) declaredParents[child] = parents = [];
                parents.Add(container);
            }
            declaredChildren[container] = known;
        }
        Declare(Root, Json.Strings(doc.Arr("children")));
        foreach (var (id, entry) in elements)
        {
            if (entry.Type == "group") Declare(id, Json.Strings(entry.Element.Arr("children")));
        }

        // Effective parent: variant structure wins (D38), else the declared one.
        var moved = variant.Obj("structure").Obj("parents");
        var parent = new Dictionary<string, string>();
        foreach (var id in elements.Keys)
        {
            var declared = declaredParents.GetValueOrDefault(id) ?? [];
            if (declared.Count > 1) issues.Add(new TreeIssue(TreeIssueKind.MultipleParents, id));
            if (moved.Str(id) is { } target)
            {
                if (target != Root && !elements.ContainsKey(target))
                {
                    issues.Add(new TreeIssue(TreeIssueKind.UnknownParent, id, Ref: target));
                }
                else if (!IsContainer(target))
                {
                    issues.Add(new TreeIssue(TreeIssueKind.NotAGroup, id, Ref: target));
                }
                else
                {
                    parent[id] = target;
                    continue;
                }
            }
            if (declared.Count > 0) parent[id] = declared[0];
        }

        // Children per container: order override, then declared order, then moved-in by id.
        var children = new Dictionary<string, List<string>>();
        var order = variant.Obj("structure").Obj("order");
        var containers = new List<string> { Root };
        containers.AddRange(elements.Where(e => e.Value.Type == "group").Select(e => e.Key));
        foreach (var container in containers)
        {
            bool Inside(string id) => parent.TryGetValue(id, out var p) && p == container;
            var result = new List<string>();
            var taken = new HashSet<string>();
            void Take(string id)
            {
                if (!taken.Contains(id) && Inside(id))
                {
                    taken.Add(id);
                    result.Add(id);
                }
            }
            foreach (var id in Json.Strings(order.Arr(container))) Take(id);
            foreach (var id in declaredChildren.GetValueOrDefault(container) ?? []) Take(id);
            var movedIn = elements.Keys.Where(id => Inside(id) && !taken.Contains(id)).OrderBy(id => id, StringComparer.Ordinal).ToList();
            foreach (var id in movedIn) Take(id);
            children[container] = result;
        }

        // Cycles: walking up from an element returns to it.
        var onCycle = new List<string>();
        foreach (var id in elements.Keys)
        {
            var seen = new HashSet<string>();
            string? current = id;
            while (current != null && current != Root && seen.Add(current))
            {
                current = parent.GetValueOrDefault(current);
            }
            if (current == id) onCycle.Add(id);
        }
        foreach (var id in onCycle) issues.Add(new TreeIssue(TreeIssueKind.Cycle, id));

        var reachable = new List<string>();
        void Visit(string container)
        {
            foreach (var child in children.GetValueOrDefault(container) ?? [])
            {
                reachable.Add(child);
                Visit(child);
            }
        }
        Visit(Root);

        foreach (var id in elements.Keys)
        {
            if (!parent.ContainsKey(id) && !onCycle.Contains(id)) issues.Add(new TreeIssue(TreeIssueKind.Orphan, id));
        }
        return new View { Elements = elements, Parent = parent, Children = children, Reachable = reachable, Issues = issues };
    }

    private static JsonObject MergeParts(JsonObject? baseParts, JsonObject? over)
    {
        var result = new JsonObject();
        foreach (var (id, node) in Json.Entries(baseParts))
        {
            var part = (JsonObject)node!.DeepClone();
            if (!part.ContainsKey("props")) part["props"] = new JsonObject();
            result[id] = part;
        }
        foreach (var (id, node) in Json.Entries(over))
        {
            var part = node!.AsObject();
            if (result[id] is not JsonObject current) result[id] = current = new JsonObject { ["props"] = new JsonObject() };
            if (part.Has("lockAspect")) current["lockAspect"] = Json.Clone(part["lockAspect"]);
            var props = current.Obj("props")!;
            foreach (var (key, value) in Json.Entries(part.Obj("props"))) props[key] = Json.Clone(value);
        }
        return result;
    }

    private static OrderedDictionary<string, EffectiveClip> EffectiveClips(JsonObject doc, JsonObject? variant)
    {
        var result = new OrderedDictionary<string, EffectiveClip>();
        void Add(string id, JsonNode? clip, ValueOrigin origin) =>
            result[id] = new EffectiveClip { Id = id, Origin = origin, Clip = (JsonObject)clip!.DeepClone(), Overridden = [] };
        foreach (var (id, clip) in Json.Entries(doc.Obj("clips"))) Add(id, clip, ValueOrigin.Standard);
        foreach (var (id, clip) in Json.Entries(variant.Obj("addedClips")))
        {
            if (!result.ContainsKey(id)) Add(id, clip, ValueOrigin.Variant);
        }
        foreach (var (id, node) in Json.Entries(variant.Obj("clips")))
        {
            if (!result.TryGetValue(id, out var clip) || clip.Origin != ValueOrigin.Standard) continue;
            foreach (var (key, value) in Json.Entries(node!.AsObject()))
            {
                clip.Clip[key] = Json.Clone(value);
                clip.Overridden.Add(key);
            }
        }
        return result;
    }

    /// <summary>Effective configuration of the standard (streamId null) or a stream, without enable checks.</summary>
    public static EffectiveConfig EffectiveConfig(JsonObject doc, string? streamId)
    {
        var variant = streamId == null ? null : doc.Obj("variants").Obj(streamId);
        var view = BuildView(doc, variant);
        var elements = new OrderedDictionary<string, EffectiveElement>();

        void Build(string id, bool parentDisabled)
        {
            var (element, origin) = view.Elements[id];
            var type = element.Str("type")!;
            var over = origin == ValueOrigin.Standard ? variant.Obj("elements").Obj(id) : null;
            var props = new JsonObject();
            var propOrigins = new OrderedDictionary<string, ValueOrigin>();
            foreach (var (key, value) in Json.Entries(element.Obj("props")))
            {
                props[key] = Json.Clone(value);
                propOrigins[key] = origin;
            }
            foreach (var (key, value) in Json.Entries(over.Obj("props")))
            {
                props[key] = Json.Clone(value);
                propOrigins[key] = ValueOrigin.Variant;
            }
            var disabled = over.Bool("disabled") ?? element.Bool("disabled") ?? false;
            var effective = new EffectiveElement
            {
                Id = id,
                Type = type,
                Origin = origin,
                Name = element.Str("name"),
                Parent = view.Parent[id],
                Children = type == "group" ? view.Children.GetValueOrDefault(id) ?? [] : null,
                Disabled = disabled,
                EffectiveDisabled = parentDisabled || disabled,
                Locked = over.Bool("locked") ?? element.Bool("locked") ?? false,
                EditorHidden = over.Bool("editorHidden") ?? element.Bool("editorHidden") ?? false,
                LockAspect = over.Bool("lockAspect") ?? element.Bool("lockAspect") ?? PropertyCatalog.DefaultLockAspect(type),
                OnInvalid = over.Str("onInvalid") ?? element.Str("onInvalid") ?? "hold",
                Props = props,
                PropOrigins = propOrigins,
                Parts = MergeParts(element.Obj("parts"), over.Obj("parts")),
                AssetId = element.Str("assetId"),
                Source = element.Str("source"),
            };
            elements[id] = effective;
            foreach (var child in view.Children.GetValueOrDefault(id) ?? []) Build(child, effective.EffectiveDisabled);
        }
        var root = view.Children.GetValueOrDefault(Root) ?? [];
        foreach (var id in root) Build(id, false);

        var rootTransform = variant.Has("workspace") ? variant.Obj("rootTransform") : variant.Obj("rootTransform") ?? doc.Obj("rootTransform");
        return new EffectiveConfig
        {
            StreamId = streamId,
            Workspace = (JsonObject)(variant.Obj("workspace") ?? doc.Obj("workspace"))!.DeepClone(),
            RootTransform = (JsonObject?)rootTransform?.DeepClone(),
            Signals = (JsonObject?)doc.Obj("signals")?.DeepClone() ?? new JsonObject(),
            Telemetry = (JsonObject?)doc.Obj("sources").Obj("telemetry")?.DeepClone() ?? new JsonObject(),
            Root = root,
            Elements = elements,
            Clips = EffectiveClips(doc, variant),
        };
    }

    /// <summary>
    /// Configuration shown for a stream: none when the vehicle overlay or the
    /// stream's variant is disabled (no fallback to the standard), else the
    /// variant or, without one, the standard.
    /// </summary>
    public static ResolveResult Resolve(JsonObject doc, string streamId)
    {
        if (doc.Bool("disabled") == true) return new ResolveResult.None(ResolveResult.VehicleDisabled);
        var variant = doc.Obj("variants").Obj(streamId);
        if (variant.Bool("disabled") == true) return new ResolveResult.None(ResolveResult.VariantDisabled);
        return new ResolveResult.Hud(EffectiveConfig(doc, variant != null ? streamId : null));
    }
}
