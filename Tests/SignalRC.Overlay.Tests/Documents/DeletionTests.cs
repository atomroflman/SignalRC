using System.Text.Json.Nodes;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Overlay.Tests.Documents;

public class DeletionTests
{
    private static JsonObject NewDoc() => JsonNode.Parse("""
        {
          "schemaVersion": 1,
          "workspace": { "width": 100, "height": 100 },
          "elements": {
            "e_g": { "type": "group", "children": ["e_a", "e_b"] },
            "e_a": { "type": "rect" },
            "e_b": { "type": "rect" },
            "e_c": { "type": "rect" }
          },
          "children": ["e_g", "e_c"],
          "clips": {
            "c_1": { "durationS": 1, "trigger": { "mode": "auto" }, "tracks": [
              { "element": "e_a", "property": "x", "keyframes": [{ "t": 0, "value": 0 }] },
              { "element": "e_c", "property": "x", "keyframes": [{ "t": 0, "value": 0 }] }
            ] }
          },
          "variants": {
            "cam": {
              "elements": { "e_a": { "props": { "x": 5 } }, "e_c": { "props": { "x": 6 } } },
              "addedElements": { "e_v": { "type": "group", "children": ["e_w"] }, "e_w": { "type": "rect" }, "e_keep": { "type": "rect" } },
              "structure": { "parents": { "e_v": "e_g", "e_c": "e_g", "e_keep": "root" }, "order": { "e_g": ["e_c", "e_a"], "root": ["e_keep", "e_g"] } },
              "addedClips": { "c_v": { "durationS": 1, "trigger": { "mode": "auto" }, "tracks": [{ "element": "e_w", "property": "x", "keyframes": [{ "t": 0, "value": 0 }] }] } }
            },
            "other": { "elements": { "e_c": { "disabled": true } } }
          }
        }
        """)!.AsObject();

    private static void AssertJson(string expected, JsonNode? actual) =>
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(expected), actual), actual?.ToJsonString());

    [Fact]
    public void ListsTheElementsVariantAdjustmentsAndClipTracksItRemoves()
    {
        AssertJson("""
            {
              "elements": ["e_a", "e_b", "e_g"],
              "clips": [{ "clip": "c_1", "tracks": [0] }],
              "variants": [{
                "streamId": "cam",
                "overrides": ["e_a"],
                "addedElements": ["e_v", "e_w"],
                "structureEntries": ["e_c", "e_v"],
                "clips": [{ "clip": "c_v", "tracks": [0] }]
              }]
            }
            """, Contracts.ToJson(DocumentResolver.DeletionImpact(NewDoc(), ["e_g"])));
    }

    [Fact]
    public void RemovesThemAndLeavesAValidDocument()
    {
        var doc = NewDoc();
        var next = DocumentResolver.DeleteElements(doc, ["e_g"]);
        Assert.Equal(["e_c"], next["elements"]!.AsObject().Select(e => e.Key).Order(StringComparer.Ordinal));
        AssertJson("""["e_c"]""", next["children"]);
        Assert.Equal(["e_c"], next["clips"]!["c_1"]!["tracks"]!.AsArray().Select(t => t!["element"]!.GetValue<string>()));
        var cam = next["variants"]!["cam"]!;
        Assert.Equal(["e_keep"], cam["addedElements"]!.AsObject().Select(e => e.Key));
        AssertJson("""{ "e_c": { "props": { "x": 6 } } }""", cam["elements"]);
        AssertJson("""{ "parents": { "e_keep": "root" }, "order": { "root": ["e_keep"] } }""", cam["structure"]);
        AssertJson("[]", cam["addedClips"]!["c_v"]!["tracks"]);
        Assert.Empty(DocumentResolver.Validate(next));
        Assert.NotNull(doc["elements"]!["e_g"]);
    }

    [Fact]
    public void IgnoresUnknownIds()
    {
        AssertJson("""{ "elements": [], "clips": [], "variants": [] }""", Contracts.ToJson(DocumentResolver.DeletionImpact(NewDoc(), ["e_nope"])));
    }

    // C#-only: a cycle in a variant tree must not hang the impact calculation.
    [Fact]
    public void TerminatesOnVariantCycles()
    {
        var doc = JsonNode.Parse("""
            { "schemaVersion": 1, "workspace": { "width": 1, "height": 1 },
              "elements": { "e_g1": { "type": "group", "children": [] }, "e_g2": { "type": "group", "children": [] }, "e_d": { "type": "rect" } },
              "children": ["e_g1", "e_g2", "e_d"],
              "variants": { "cam": {
                "addedElements": { "e_x": { "type": "rect" } },
                "structure": { "parents": { "e_g1": "e_g2", "e_g2": "e_g1", "e_x": "e_g1" } } } } }
            """)!.AsObject();
        AssertJson("""{ "elements": ["e_d"], "clips": [], "variants": [] }""", Contracts.ToJson(DocumentResolver.DeletionImpact(doc, ["e_d"])));
    }
}
