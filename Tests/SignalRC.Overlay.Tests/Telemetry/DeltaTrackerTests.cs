using System.Text.Json.Nodes;
using SignalRC.Onboard.Telemetry;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

// Runs the onboard delta logic against Shared/Overlay/fixtures/telemetry/cases.json.
public class DeltaTrackerTests
{
    private static readonly JsonObject Fixture = Contracts.ReadJson("fixtures/telemetry/cases.json")!.AsObject();

    public static TheoryData<string> CaseIds()
    {
        var data = new TheoryData<string>();
        foreach (var c in Fixture["cases"]!.AsArray()) data.Add(c!["id"]!.GetValue<string>());
        return data;
    }

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void MatchesSharedFixture(string id)
    {
        var c = Fixture["cases"]!.AsArray().Single(x => x!["id"]!.GetValue<string>() == id)!;
        var tracker = new TelemetryDeltaTracker("test");
        var actual = new JsonArray();
        var seqs = new List<long>();

        foreach (var tick in c["ticks"]!.AsArray())
        {
            var t = tick!["t"]!.GetValue<double>();
            if (tick["reconnect"]?.GetValue<bool>() == true) tracker.Reset();
            if (tick["demand"] is JsonArray demand) tracker.SetDemand(demand.Select(d => d!.GetValue<int>()));

            var read = tick["read"]!.AsObject().ToDictionary(
                kv => int.Parse(kv.Key),
                kv => new TelemetrySample(
                    kv.Value![0]!.GetValue<string>(),
                    (TelemetrySampleState)kv.Value[1]!.GetValue<int>(),
                    kv.Value[2]!.GetValue<int>()));

            var delta = tracker.Tick(read, (long)Math.Round(t * 1000));
            if (delta == null) continue;
            Assert.False(delta.IsEmpty);
            Assert.Equal("test", delta.Epoch);
            seqs.Add(delta.Seq);
            actual.Add(ToJson(t, delta));
        }

        var expected = c["expect"]!.AsArray();
        Assert.True(Contracts.IsSubset(expected, actual), $"expected {expected.ToJsonString()}\nactual   {actual.ToJsonString()}");
        Assert.Equal(seqs.OrderBy(s => s).Distinct(), seqs);
    }

    private static JsonObject ToJson(double t, TelemetryDelta d) => new()
    {
        ["t"] = t,
        ["ageMs"] = d.AgeMs,
        ["changed"] = new JsonArray(d.Changed.Select(ch =>
        {
            var entry = new JsonArray(ch.Id, ch.Value, (int)ch.State);
            if (ch.AgeMs is { } age) entry.Add(age);
            return (JsonNode)entry;
        }).ToArray()),
        ["touched"] = new JsonArray(d.Touched.Select(i => (JsonNode)i).ToArray()),
        ["touchedAged"] = new JsonArray(d.TouchedAged.Select(i => (JsonNode)i).ToArray()),
    };

    [Fact]
    public void NothingBeforeFirstDemand()
    {
        var tracker = new TelemetryDeltaTracker("e");
        var read = new Dictionary<int, TelemetrySample> { [1] = TelemetrySample.Valid("1") };
        Assert.Null(tracker.Tick(read, 0));
        tracker.SetDemand([1]);
        Assert.NotNull(tracker.Tick(read, 100));
    }

    [Fact]
    public void ResetDropsDemandButKeepsSeqIncreasing()
    {
        var tracker = new TelemetryDeltaTracker("e");
        var read = new Dictionary<int, TelemetrySample> { [1] = TelemetrySample.Valid("1") };
        tracker.SetDemand([1]);
        var first = tracker.Tick(read, 0)!;

        tracker.Reset();
        Assert.Null(tracker.Tick(read, 1000));

        tracker.SetDemand([1]);
        var second = tracker.Tick(read, 2000)!;
        Assert.Single(second.Changed);
        Assert.True(second.Seq > first.Seq);
        Assert.Equal(first.Epoch, second.Epoch);
    }

    [Fact]
    public void RedemandedChannelIsSentInFull()
    {
        var tracker = new TelemetryDeltaTracker("e");
        var read = new Dictionary<int, TelemetrySample> { [1] = TelemetrySample.Valid("1") };
        tracker.SetDemand([1]);
        tracker.Tick(read, 0);
        tracker.SetDemand([]);
        Assert.Null(tracker.Tick(read, 100));
        tracker.SetDemand([1]);
        Assert.Single(tracker.Tick(read, 150)!.Changed);
    }

    [Fact]
    public void ForgetSentResendsInFull()
    {
        var tracker = new TelemetryDeltaTracker("e");
        var read = new Dictionary<int, TelemetrySample> { [1] = TelemetrySample.Valid("1") };
        tracker.SetDemand([1]);
        tracker.Tick(read, 0);
        tracker.ForgetSent();
        Assert.Single(tracker.Tick(read, 50)!.Changed);
    }

    [Theory]
    [InlineData(new[] { 20, 20, 900 }, 20)]
    [InlineData(new[] { 30, 10 }, 10)]
    [InlineData(new[] { 5, 7, 7, 5 }, 5)]
    public void DefaultAgeIsMostFrequentSmallestOnTie(int[] ages, int expected)
        => Assert.Equal(expected, TelemetryDeltaTracker.DefaultAge(ages));
}
