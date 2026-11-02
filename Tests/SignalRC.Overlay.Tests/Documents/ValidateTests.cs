using System.Text.Json.Nodes;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;
using SignalRC.Server.Overlay.Expressions;

namespace SignalRC.Overlay.Tests.Documents;

public class ValidateTests
{
    private static readonly ResolveContext Ctx = new() { Expressions = ExpressionAnalyzer.Instance };

    private static JsonObject Case(string file) =>
        Contracts.ReadJson("fixtures/documents/cases.json")!["cases"]!.AsArray()
            .Single(c => c!["file"]!.GetValue<string>() == file)!.AsObject();

    private static TheoryData<string> Files(bool schemaValid)
    {
        var data = new TheoryData<string>();
        foreach (var c in Contracts.ReadJson("fixtures/documents/cases.json")!["cases"]!.AsArray())
        {
            if (c!["schemaValid"]!.GetValue<bool>() == schemaValid) data.Add(c["file"]!.GetValue<string>());
        }
        return data;
    }

    public static TheoryData<string> SchemaValidFiles() => Files(true);
    public static TheoryData<string> SchemaInvalidFiles() => Files(false);

    [Theory]
    [MemberData(nameof(SchemaValidFiles))]
    public void MatchesSharedFixture(string file)
    {
        var c = Case(file);
        var actual = DocumentResolver.Validate(Contracts.ReadJson($"fixtures/documents/{file}"), Ctx);
        var expected = c["diagnostics"]?.AsArray().Select(e => e!.AsObject()).ToList() ?? [];
        var allowExtra = c["allowExtra"]?.AsArray().Select(x => x!.GetValue<string>()).ToList() ?? [];
        bool Matches(JsonObject e, Diagnostic a) => a.Code == e["code"]!.GetValue<string>() && Contracts.IsSubset(e["location"], Contracts.ToJson(a.Location));

        foreach (var e in expected)
        {
            var match = actual.FirstOrDefault(a => Matches(e, a) && Contracts.ToJson(a.Category)!.GetValue<string>() == e["category"]!.GetValue<string>());
            Assert.True(match != null, $"{e["code"]} at {e["location"]!.ToJsonString()} in {Contracts.ToJson(actual)!.ToJsonString()}");
        }
        var extra = actual.Where(a => !expected.Any(e => Matches(e, a)) && !allowExtra.Contains(a.Code)).ToList();
        Assert.True(extra.Count == 0, Contracts.ToJson(extra)!.ToJsonString());
    }

    [Theory]
    [MemberData(nameof(SchemaInvalidFiles))]
    public void RejectsSchemaInvalidFixtureStructurally(string file)
    {
        var d = DocumentResolver.Validate(Contracts.ReadJson($"fixtures/documents/{file}"));
        Assert.NotEmpty(d);
        Assert.False(DocumentResolver.CanSave(d));
    }

    // --- Rules beyond the fixtures ---

    private static JsonObject Doc(string partial)
    {
        var doc = JsonNode.Parse("""{ "schemaVersion": 1, "workspace": { "width": 100, "height": 100 }, "elements": {}, "children": [] }""")!.AsObject();
        foreach (var (key, value) in JsonNode.Parse(partial)!.AsObject().ToList()) doc[key] = value?.DeepClone();
        return doc;
    }

    /// <summary>Like toMatchObject on the diagnostic list: same length, each entry a subset match.</summary>
    private static void AssertMatches(IReadOnlyList<Diagnostic> diagnostics, string expectedJson)
    {
        var actual = Contracts.ToJson(diagnostics);
        Assert.True(Contracts.IsSubset(JsonNode.Parse(expectedJson), actual), actual!.ToJsonString());
    }

    private static string[] Codes(IEnumerable<Diagnostic> d) => d.Select(x => x.Code).ToArray();

    [Fact]
    public void DowngradesFormulaErrorsInDisabledElementsToWarnings()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_a": { "type": "valueText", "disabled": true, "props": { "value": { "base": null, "binding": { "expr": "sig(\"x\")" } } } } },
              "children": ["e_a"] }
            """), Ctx);
        AssertMatches(d, """[{ "code": "OVL_REF_UNKNOWN_SOURCE", "category": "warning" }]""");
        Assert.True(DocumentResolver.CanPublish(d));
    }

    [Fact]
    public void KeepsFormulaErrorsActiveWhenAVariantReenablesTheElement()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_a": { "type": "valueText", "disabled": true, "props": { "value": { "base": null, "binding": { "expr": "sig(\"x\")" } } } } },
              "children": ["e_a"],
              "variants": { "cam": { "elements": { "e_a": { "disabled": false } } } } }
            """), Ctx);
        AssertMatches(d, """[{ "code": "OVL_REF_UNKNOWN_SOURCE", "category": "publish" }]""");
    }

    [Fact]
    public void TreatsADisabledVehicleOverlayAsDisabledEverywhere()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "disabled": true,
              "elements": { "e_a": { "type": "valueText", "props": { "value": { "base": null, "binding": { "expr": "sig(\"x\")" } } } } },
              "children": ["e_a"] }
            """), Ctx);
        Assert.Equal([DiagnosticCategory.Warning], d.Select(x => x.Category));
    }

    [Fact]
    public void DoesNotDowngradeStructureProblemsInDisabledParts()
    {
        var d = DocumentResolver.Validate(Doc("""{ "elements": { "e_a": { "type": "rect", "disabled": true, "props": { "fontSize": 3 } } }, "children": ["e_a"] }"""));
        AssertMatches(d, """[{ "code": "OVL_PROP_UNKNOWN", "category": "structure" }]""");
    }

    [Fact]
    public void WarnsAboutOrphanedVariantsOnlyWhenStreamsAreKnown()
    {
        var d0 = Doc("""{ "variants": { "gone": {} } }""");
        Assert.Empty(DocumentResolver.Validate(d0));
        AssertMatches(DocumentResolver.Validate(d0, new ResolveContext { Streams = ["front"] }),
            """[{ "code": "OVL_VARIANT_ORPHANED", "category": "warning", "location": { "variant": "gone" } }]""");
    }

    [Fact]
    public void ReportsAVariantOnlyOwnershipConflictAsPublish()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_a": { "type": "rect" } },
              "children": ["e_a"],
              "clips": { "c_1": { "durationS": 1, "trigger": { "mode": "auto" }, "tracks": [{ "element": "e_a", "property": "x", "keyframes": [{ "t": 0, "value": 0 }] }] } },
              "variants": { "cam": { "elements": { "e_a": { "props": { "x": { "base": 0, "binding": { "expr": "1" } } } } } } } }
            """));
        AssertMatches(d, """[{ "code": "OVL_CLIP_PROPERTY_CONFLICT", "category": "publish", "location": { "variant": "cam", "clip": "c_1" } }]""");
        Assert.True(DocumentResolver.CanSave(d));
    }

    [Fact]
    public void RequiresAddedElementsToBePlaced()
    {
        var d = DocumentResolver.Validate(Doc("""{ "variants": { "cam": { "addedElements": { "e_x": { "type": "rect" } } } } }"""));
        AssertMatches(d, """[{ "code": "OVL_STRUCT_ORPHAN", "location": { "variant": "cam", "element": "e_x" } }]""");
    }

    [Fact]
    public void RejectsRegroupingIntoANonGroup()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_a": { "type": "rect" }, "e_b": { "type": "rect" } },
              "children": ["e_a", "e_b"],
              "variants": { "cam": { "structure": { "parents": { "e_a": "e_b" } } } } }
            """));
        Assert.Equal(["OVL_STRUCT_NOT_A_GROUP"], Codes(d));
    }

    [Fact]
    public void ChecksColorsEnumsAndIntegersOfLiterals()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_t": { "type": "text", "props": { "fill": "red", "align": "center", "fontSize": 0 } }, "e_g": { "type": "radialGauge", "props": { "tickCount": 2.5 } } },
              "children": ["e_t", "e_g"] }
            """));
        Assert.Equal(
            [
                "OVL_PROP_OUT_OF_RANGE:e_t.align",
                "OVL_PROP_OUT_OF_RANGE:e_t.fontSize",
                "OVL_PROP_TYPE:e_g.tickCount",
                "OVL_PROP_TYPE:e_t.fill",
            ],
            d.Select(x => $"{x.Code}:{x.Location.Element}.{x.Location.Property}").OrderBy(x => x, StringComparer.Ordinal));
    }

    [Fact]
    public void ChecksLidarSourcesAndAssetReferencesWhenContextIsGiven()
    {
        var d = DocumentResolver.Validate(Doc($$"""
            { "elements": {
                "e_l": { "type": "lidarWidget", "source": "lidarGrid" },
                "e_s": { "type": "svgAsset", "assetId": "sha256-{{new string('0', 64)}}", "parts": { "p_1": { "props": { "opacity": 0.5 } } } } },
              "children": ["e_l", "e_s"] }
            """), new ResolveContext
        {
            Sources = new SourceCatalog(new Dictionary<string, TelemetryDataType> { ["lidarGrid"] = TelemetryDataType.String }, []),
            Assets = new Dictionary<string, AssetMetadata>(),
        });
        Assert.Equal(["OVL_REF_UNKNOWN_ASSET", "OVL_REF_UNKNOWN_SOURCE"], Codes(d).OrderBy(x => x, StringComparer.Ordinal));
    }

    [Fact]
    public void EnforcesTheElementLimitPerEffectiveView()
    {
        var doc = Doc("{}");
        var elements = doc["elements"]!.AsObject();
        var children = doc["children"]!.AsArray();
        for (var i = 0; i < 501; i++)
        {
            elements[$"e_{i}"] = new JsonObject { ["type"] = "rect" };
            children.Add($"e_{i}");
        }
        AssertMatches(DocumentResolver.Validate(doc),
            """[{ "code": "OVL_LIMIT_EXCEEDED", "category": "structure", "location": { "limit": "elements" } }]""");
    }

    // C#-only: map lookups use own keys, unlike a plain JavaScript object lookup.
    [Fact]
    public void TreatsPrototypeNamesAsOrdinaryIds()
    {
        var d = DocumentResolver.Validate(Doc("""
            { "elements": { "e_a": { "type": "rect", "props": { "constructor": 1 } } },
              "children": ["e_a"],
              "variants": { "cam": { "elements": { "toString": {} } } } }
            """));
        Assert.Equal(["OVL_PROP_UNKNOWN", "OVL_REF_UNKNOWN_ELEMENT"], Codes(d));
    }
}
