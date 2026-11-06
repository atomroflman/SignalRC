using System.Text.Json.Nodes;
using SignalRC.Onboard.Flow;
using SignalRC.Overlay.Tests.Testing;

namespace SignalRC.Overlay.Tests.Flow;

// T15: the onboard functions behave like the browser functions. The same cases run in
// Client/src/components/filters/flow-parity.test.ts.
public class FlowParityTests
{
    private static readonly string CasesPath = Path.Combine(Contracts.RepositoryRoot, "Shared", "FlowParity", "cases.json");

    public static IEnumerable<object[]> Cases() =>
        JsonNode.Parse(File.ReadAllText(CasesPath))!["cases"]!.AsArray().Select(c => new object[] { c!["name"]!.GetValue<string>() });

    [Theory]
    [MemberData(nameof(Cases))]
    public void Function_matches_reference(string name)
    {
        var c = JsonNode.Parse(File.ReadAllText(CasesPath))!["cases"]!.AsArray().First(x => x!["name"]!.GetValue<string>() == name)!;
        var fn = FlowFunctions.Get(c["function"]!.GetValue<string>());
        Assert.NotNull(fn);
        var p = c["params"]!.AsObject().ToDictionary(kv => kv.Key, kv => (string?)kv.Value?.GetValue<string>());
        var state = fn!.CreateState();
        var ctx = new FixedContext();
        var stepNo = 0;
        foreach (var step in c["steps"]!.AsArray())
        {
            stepNo++;
            var inputs = fn.Inputs.ToDictionary(l => l, l => step!["inputs"]![l]?.GetValue<double>() ?? 0);
            var outputs = fn.Apply(inputs, p, state, ctx);
            var expect = step!["expect"]!.AsArray().Select(v => v!.GetValue<double>()).ToArray();
            Assert.True(outputs.Length >= expect.Length, $"{name} step {stepNo}: {outputs.Length} outputs");
            for (var i = 0; i < expect.Length; i++)
                Assert.True(Math.Abs(expect[i] - outputs[i]) < 1e-9, $"{name} step {stepNo} output {i}: expected {expect[i]}, got {outputs[i]}");
        }
    }

    [Fact]
    public void Every_function_has_a_reference_case()
    {
        var covered = JsonNode.Parse(File.ReadAllText(CasesPath))!["cases"]!.AsArray().Select(c => c!["function"]!.GetValue<string>()).ToHashSet();
        Assert.DoesNotContain(FlowFunctions.Names, n => !covered.Contains(n));
    }

    private sealed class FixedContext : IFlowFunctionContext
    {
        public long NowMs => 1000;
        public (string Value, bool Valid)? Telemetry(string channelName) => null;
        public void DisconnectControllers(string? filter) { }
        public void PublishTelemetry(string key, double value) { }
        public void ControllerRumble(string? filter, double strong, double weak) { }
        public void ControllerLight(string? filter, double red, double green, double blue) { }
    }
}
