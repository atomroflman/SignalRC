using System.Text.Json.Nodes;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;
using SignalRC.Server.Overlay.Expressions;

namespace SignalRC.Overlay.Tests.Expressions;

// Mirrors the analysis part of the client's expression.test.ts; evaluation and
// formatting are client-only.
public class ExpressionTests
{
    private static readonly JsonObject Fixture = Contracts.ReadJson("fixtures/expressions/cases.json")!.AsObject();

    private static readonly ExpressionEnvironment Env = new(
        Fixture["context"]!["telemetry"]!.AsObject().ToDictionary(kv => kv.Key, kv => Enum.Parse<TelemetryDataType>(kv.Value!["dataType"]!.GetValue<string>())),
        Fixture["context"]!["outputs"]!.AsObject().Select(kv => kv.Key).ToList(),
        Fixture["context"]!["signals"]!.AsObject().Select(kv => kv.Key).ToList());

    public static TheoryData<string> CaseIds()
    {
        var data = new TheoryData<string>();
        foreach (var c in Fixture["cases"]!.AsArray()) data.Add(c!["id"]!.GetValue<string>());
        return data;
    }

    private static string Category(DiagnosticCategory c) => Contracts.ToJson(c)!.GetValue<string>();

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void MatchesSharedFixture(string id)
    {
        var c = Fixture["cases"]!.AsArray().Single(x => x!["id"]!.GetValue<string>() == id)!;
        var expected = c["expectedKind"]?.GetValue<string>() ?? Fixture["defaultExpectedKind"]!.GetValue<string>();
        var analysis = Analyzer.Analyze(c["expr"]!.GetValue<string>(), Env, expected);
        var spec = c["analysis"]!;

        Assert.Equal(
            spec["diagnostics"]!.AsArray().Select(d => $"{d!["code"]}/{d["category"]}@{d["offset"]}"),
            analysis.Diagnostics.Select(d => $"{d.Code}/{Category(d.Category)}@{d.Offset}"));
        if (spec["type"] is { } type) Assert.Equal(type.GetValue<string>(), Analyzer.Name(analysis.Type));
        if (spec["dependencies"] is JsonArray dependencies)
        {
            Assert.Equal(
                dependencies.Select(d => $"{d!["kind"]}:{d["name"]}"),
                analysis.Dependencies.Select(d => $"{Contracts.ToJson(d.Kind)!.GetValue<string>()}:{d.Name}"));
        }
    }

    // --- Analysis rules ---

    private static string[] Codes(string expr, ExpressionEnvironment? env = null, string kind = "any") =>
        Analyzer.Analyze(expr, env ?? Env, kind).Diagnostics.Select(d => $"{d.Code}@{d.Offset}").ToArray();

    [Fact]
    public void ReportsTheFirstSemanticErrorInSourceOrderBeforeAResultTypeError()
    {
        Assert.Equal(["OVL_EXPR_TYPE@0"], Codes("\"a\" + tel(\"nope\")", Env, "bool"));
        Assert.Equal(["OVL_EXPR_UNKNOWN_FUNCTION@4"], Codes("1 + foo(2)", Env, "bool"));
    }

    [Fact]
    public void DoesNotCheckSourcesTheEnvironmentDoesNotKnow()
    {
        var unknown = new ExpressionEnvironment(null, null, []);
        Assert.Empty(Codes("tel(\"anything\") + out(\"x\")", unknown));
        Assert.Equal(["OVL_REF_UNKNOWN_SOURCE@0"], Codes("sig(\"x\")", unknown));
    }

    [Fact]
    public void RequiresMatchingTypesForIfFallbackAndEquality()
    {
        Assert.Equal(["OVL_EXPR_TYPE@12"], Codes("if(true, 1, \"a\")"));
        Assert.Equal(["OVL_EXPR_TYPE@3"], Codes("if(1, 2, 3)"));
        Assert.Equal(["OVL_EXPR_TYPE@12"], Codes("fallback(1, \"x\")"));
        Assert.Equal(["OVL_EXPR_TYPE@5"], Codes("1 == \"1\""));
    }

    [Theory]
    [InlineData("1 2", 2)]
    [InlineData("(1 + 2", 6)]
    [InlineData("speed * 2", 0)]
    [InlineData("\"open", 0)]
    [InlineData("\"a\\nb\"", 2)]
    [InlineData("1 # 2", 2)]
    [InlineData("1e999", 0)]
    [InlineData("1 2 ?", 2)]
    [InlineData("speed #", 0)]
    public void RejectsSyntaxAtTheOffendingToken(string expr, int offset)
    {
        Assert.Equal([$"OVL_EXPR_SYNTAX@{offset}"], Codes(expr));
    }

    [Fact]
    public void RejectsALidarGridChannelAsFormulaValue()
    {
        var env = new ExpressionEnvironment(new Dictionary<string, TelemetryDataType> { ["grid"] = TelemetryDataType.LidarGrid }, null, []);
        Assert.Equal(["OVL_EXPR_TYPE@0"], Codes("tel(\"grid\") + 1", env));
    }

    [Fact]
    public void CountsLengthInCodePoints()
    {
        Assert.Empty(Codes($"\"{string.Concat(Enumerable.Repeat("😀", 998))}\""));
        Assert.Equal(["OVL_LIMIT_EXCEEDED@0"], Codes($"\"{string.Concat(Enumerable.Repeat("😀", 999))}\""));
    }
}
