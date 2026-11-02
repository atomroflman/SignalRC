using System.Text.Json.Nodes;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Overlay.Documents;
using SignalRC.Server.Overlay.Expressions;

namespace SignalRC.Overlay.Tests.Acceptance;

// AP14: the abuse corpus of the client (security-expressions.json) gives the
// same diagnostics in the server analysis used by the publish check.
public class SecurityExpressionTests
{
    private static readonly JsonObject Corpus = JsonNode.Parse(File.ReadAllText(Path.Combine(
        Contracts.RepositoryRoot, "Client", "src", "components", "overlay", "acceptance", "security-expressions.json")))!.AsObject();

    private static readonly ExpressionEnvironment Env = new(
        Corpus["env"]!["telemetry"]!.AsObject().ToDictionary(kv => kv.Key, kv => Enum.Parse<TelemetryDataType>(kv.Value!.GetValue<string>())),
        Corpus["env"]!["outputs"]!.AsArray().Select(v => v!.GetValue<string>()).ToList(),
        Corpus["env"]!["signals"]!.AsArray().Select(v => v!.GetValue<string>()).ToList());

    private static string Text(JsonNode c) => c["expr"]?.GetValue<string>()
        ?? string.Concat(c["repeat"]!.AsArray().Select(p => string.Concat(Enumerable.Repeat(p![0]!.GetValue<string>(), p[1]!.GetValue<int>()))));

    public static TheoryData<int> Cases()
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Corpus["cases"]!.AsArray().Count; i++) data.Add(i);
        return data;
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void ServerAnalysisMatchesTheClient(int index)
    {
        var c = Corpus["cases"]![index]!;
        var analysis = Analyzer.Analyze(Text(c), Env, "any");
        Assert.Equal(
            c["diagnostics"]!.AsArray().Select(d => d!.GetValue<string>()),
            analysis.Diagnostics.Select(d => $"{d.Code}/{Contracts.ToJson(d.Category)!.GetValue<string>()}@{d.Offset}"));
    }

    [Fact]
    public void CorpusIsNotTrivial() => Assert.True(Corpus["cases"]!.AsArray().Count >= 70);
}
