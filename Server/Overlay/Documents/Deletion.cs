using System.Text.Json.Nodes;

namespace SignalRC.Server.Overlay.Documents;

// Consequences of deleting standard elements (product plan "Standard und
// Vererbung"): the editor shows them before the user confirms.

public sealed record ClipImpact(string Clip, IReadOnlyList<int> Tracks);

public sealed record VariantImpact(
    string StreamId,
    // Overrides of deleted standard elements.
    IReadOnlyList<string> Overrides,
    // Variant-added elements inside a deleted group, with their descendants.
    IReadOnlyList<string> AddedElements,
    // Regrouping entries that name a deleted element.
    IReadOnlyList<string> StructureEntries,
    // Overridden or added clips losing tracks.
    IReadOnlyList<ClipImpact> Clips);

public sealed record DeletionImpact(
    // Deleted standard elements including descendants.
    IReadOnlyList<string> Elements,
    // Standard clips losing tracks; a clip is kept even when it loses all of them.
    IReadOnlyList<ClipImpact> Clips,
    IReadOnlyList<VariantImpact> Variants);

public static partial class DocumentResolver
{
    private static HashSet<string> Descendants(Dictionary<string, List<string>> children, IEnumerable<string> roots)
    {
        var result = new HashSet<string>();
        void Visit(string id)
        {
            if (!result.Add(id)) return;
            foreach (var child in children.GetValueOrDefault(id) ?? []) Visit(child);
        }
        foreach (var id in roots) Visit(id);
        return result;
    }

    private static List<int> AffectedTracks(JsonArray? tracks, ISet<string> removed)
    {
        var result = new List<int>();
        for (var i = 0; i < (tracks?.Count ?? 0); i++)
        {
            if (removed.Contains(tracks![i]!.AsObject().Str("element")!)) result.Add(i);
        }
        return result;
    }

    private static List<ClipImpact> ClipImpacts(IEnumerable<KeyValuePair<string, JsonNode?>> clips, ISet<string> removed) =>
        clips.Select(e => new ClipImpact(e.Key, AffectedTracks(e.Value!.AsObject().Arr("tracks"), removed)))
            .Where(c => c.Tracks.Count > 0)
            .OrderBy(c => c.Clip, StringComparer.Ordinal)
            .ToList();

    private static List<string> SortedIds(IEnumerable<string> ids) => ids.OrderBy(id => id, StringComparer.Ordinal).ToList();

    // What deleting the given standard elements removes. Unknown ids are ignored.
    public static DeletionImpact DeletionImpact(JsonObject doc, IEnumerable<string> ids)
    {
        var standard = BuildView(doc);
        var elements = doc.Obj("elements");
        var removed = Descendants(standard.Children, ids.Where(elements.Has));
        var clips = ClipImpacts(Json.Entries(doc.Obj("clips")), removed);

        var variants = new List<VariantImpact>();
        foreach (var (streamId, node) in Json.Sorted(doc.Obj("variants")))
        {
            var variant = node!.AsObject();
            var view = BuildView(doc, variant);
            var inRemoved = view.Elements.Keys.Where(id =>
            {
                if (view.Elements[id].Origin != ValueOrigin.Variant) return false;
                // The seen set only guards against cycles in the variant tree.
                var seen = new HashSet<string>();
                for (var p = view.Parent.GetValueOrDefault(id); p != null && p != Root && seen.Add(p); p = view.Parent.GetValueOrDefault(p))
                {
                    if (removed.Contains(p)) return true;
                }
                return false;
            }).ToList();
            var added = Descendants(view.Children, inRemoved);
            var gone = new HashSet<string>(removed);
            gone.UnionWith(added);
            var impact = new VariantImpact(
                streamId,
                SortedIds(Json.Keys(variant.Obj("elements")).Where(removed.Contains)),
                SortedIds(added),
                SortedIds(Json.Entries(variant.Obj("structure").Obj("parents"))
                    .Where(e => gone.Contains(e.Key) || gone.Contains(e.Value!.GetValue<string>())).Select(e => e.Key)),
                ClipImpacts(Json.Entries(variant.Obj("clips")).Concat(Json.Entries(variant.Obj("addedClips"))), gone));
            if (impact.Overrides.Count > 0 || impact.AddedElements.Count > 0 || impact.StructureEntries.Count > 0 || impact.Clips.Count > 0)
            {
                variants.Add(impact);
            }
        }
        return new DeletionImpact(SortedIds(removed), clips, variants);
    }

    // Returns a copy of the document with the elements and all dependent adjustments removed.
    public static JsonObject DeleteElements(JsonObject doc, IEnumerable<string> ids)
    {
        var impact = DeletionImpact(doc, ids);
        var next = (JsonObject)doc.DeepClone();
        var removed = new HashSet<string>(impact.Elements);

        static void FilterIds(JsonObject? o, string key, ISet<string> gone)
        {
            if (o?[key] is JsonArray list) o[key] = Json.StringArray(Json.Strings(list).Where(id => !gone.Contains(id)));
        }
        static void DropTracks(JsonObject? clips, ISet<string> gone)
        {
            foreach (var (_, clip) in Json.Entries(clips))
            {
                var c = clip!.AsObject();
                if (c["tracks"] is JsonArray tracks)
                {
                    c["tracks"] = new JsonArray(tracks.Where(t => !gone.Contains(t!.AsObject().Str("element")!)).Select(t => t!.DeepClone()).ToArray());
                }
            }
        }

        var elements = next.Obj("elements")!;
        foreach (var id in removed) elements.Remove(id);
        FilterIds(next, "children", removed);
        foreach (var (_, element) in elements) FilterIds(element!.AsObject(), "children", removed);
        DropTracks(next.Obj("clips"), removed);

        foreach (var v in impact.Variants)
        {
            var variant = next.Obj("variants").Obj(v.StreamId)!;
            var gone = new HashSet<string>(removed);
            gone.UnionWith(v.AddedElements);
            foreach (var id in v.Overrides) variant.Obj("elements")!.Remove(id);
            foreach (var id in v.AddedElements) variant.Obj("addedElements")!.Remove(id);
            foreach (var (_, element) in Json.Entries(variant.Obj("addedElements"))) FilterIds(element!.AsObject(), "children", gone);
            foreach (var id in v.StructureEntries) variant.Obj("structure").Obj("parents")!.Remove(id);
            if (variant.Obj("structure").Obj("order") is { } order)
            {
                foreach (var container in Json.Keys(order))
                {
                    if (gone.Contains(container)) order.Remove(container);
                    else FilterIds(order, container, gone);
                }
            }
            DropTracks(variant.Obj("clips"), gone);
            DropTracks(variant.Obj("addedClips"), gone);
        }
        return next;
    }
}
