using System.Text.Json.Nodes;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;

namespace SignalRC.Overlay.Tests.Documents;

public class ResolveTests
{
    private static JsonObject Case(string id) =>
        Contracts.ReadJson("fixtures/documents/resolution.json")!["cases"]!.AsArray()
            .Single(c => c!["id"]!.GetValue<string>() == id)!.AsObject();

    public static TheoryData<string> Cases()
    {
        var data = new TheoryData<string>();
        foreach (var c in Contracts.ReadJson("fixtures/documents/resolution.json")!["cases"]!.AsArray()) data.Add(c!["id"]!.GetValue<string>());
        return data;
    }

    private static JsonObject Hud(EffectiveConfig config)
    {
        var o = new JsonObject { ["kind"] = "hud" };
        foreach (var (key, value) in config.ToJson().ToList()) o[key] = value?.DeepClone();
        return o;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void MatchesSharedFixture(string id)
    {
        var c = Case(id);
        var doc = c["inline"]?.DeepClone().AsObject() ?? Contracts.ReadJson($"fixtures/documents/{c["file"]!.GetValue<string>()}")!.AsObject();
        var stream = c["stream"]?.GetValue<string>();
        var actual = stream == null
            ? Hud(DocumentResolver.EffectiveConfig(doc, null))
            : DocumentResolver.Resolve(doc, stream) switch
            {
                ResolveResult.Hud hud => Hud(hud.Config),
                ResolveResult.None none => new JsonObject { ["kind"] = "none", ["reason"] = none.Reason },
                _ => throw new InvalidOperationException(),
            };
        Assert.True(Contracts.IsSubset(c["expect"], actual), actual.ToJsonString());
    }

    [Fact]
    public void DoesNotLetVariantDataLeakIntoTheStandard()
    {
        var doc = Contracts.ReadJson("fixtures/documents/valid/variants-clips-lidar.json")!.AsObject();
        var before = doc.ToJsonString();
        DocumentResolver.EffectiveConfig(doc, "front-wide");
        Assert.Equal(before, doc.ToJsonString());
        Assert.False(DocumentResolver.EffectiveConfig(doc, null).Elements.ContainsKey("e_front_box"));
    }

    [Fact]
    public void ExcludesElementsThatAreNotReachableFromTheRoot()
    {
        var doc = JsonNode.Parse("""
            { "schemaVersion": 1, "workspace": { "width": 1, "height": 1 },
              "elements": { "e_a": { "type": "rect" }, "e_lost": { "type": "rect" } },
              "children": ["e_a"] }
            """)!.AsObject();
        Assert.Equal(["e_a"], DocumentResolver.EffectiveConfig(doc, null).Elements.Keys);
    }

    // C#-only: JavaScript iterates array-index keys first, which decides the
    // declared parent of an element listed twice; the server follows it.
    [Fact]
    public void UsesJavaScriptKeyOrderForDeclaredParents()
    {
        var doc = JsonNode.Parse("""
            { "schemaVersion": 1, "workspace": { "width": 1, "height": 1 },
              "elements": { "g_b": { "type": "group", "children": ["e_x"] }, "1": { "type": "group", "children": ["e_x"] }, "e_x": { "type": "rect" } },
              "children": ["g_b", "1"] }
            """)!.AsObject();
        Assert.Equal("1", DocumentResolver.EffectiveConfig(doc, null).Elements["e_x"].Parent);
    }
}
