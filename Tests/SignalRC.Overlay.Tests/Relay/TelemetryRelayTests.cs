using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Server;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Relay;

public class TelemetryRelayTests
{
    private const int Car = 7;
    private readonly FakeTransport _out = new();
    private readonly TelemetryRelay _relay;

    public TelemetryRelayTests()
    {
        _relay = new TelemetryRelay(_out, new FakeDirectory(), TimeProvider.System, NullLogger<TelemetryRelay>.Instance);
    }

    private static TelemetryDelta Delta(long seq, int age = 10, (int Id, string Value, TelemetrySampleState State)[]? changed = null,
        int[]? touched = null, int[]? touchedAged = null, string epoch = "e1") => new()
    {
        Epoch = epoch, Seq = seq, AgeMs = age,
        Changed = (changed ?? []).Select(c => new TelemetryChange { Id = c.Id, Value = c.Value, State = c.State }).ToList(),
        Touched = touched ?? [], TouchedAged = touchedAged ?? [],
    };

    [Fact]
    public async Task DemandIsTheUnionOfInterestsAndCoalesced()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        Assert.Equal([Array.Empty<int>()], _out.Demands.Select(d => d.Ids));
        await _relay.SetInterestAsync("a", Car, [2, 1]);
        await _relay.SetInterestAsync("b", Car, [2, 3]);
        await Task.Delay(500);
        Assert.Equal([1, 2, 3], _out.Demands[^1].Ids);
        Assert.Equal(2, _out.Demands.Count);
        await _relay.ConnectionClosedAsync("b");
        await Task.Delay(500);
        Assert.Equal([1, 2], _out.Demands[^1].Ids);
    }

    [Fact]
    public async Task ForwardsOnlyInterestingChannelsWithCompactEntries()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.SetInterestAsync("a", Car, [1]);
        await _relay.OnDeltaAsync(Car, Delta(0, 10, [(1, "12.5", TelemetrySampleState.Valid), (2, "3", TelemetrySampleState.Unchecked)]));
        await _relay.OnDeltaAsync(Car, Delta(1, 20, touched: [1, 2]));
        await _relay.OnDeltaAsync(Car, Delta(2, 20, touchedAged: [2, 900, 1, 50]));
        var a = _out.Samples.Where(s => s.Connection == "a").ToList();
        Assert.Equal(3, a.Count);
        Assert.Equal("[[1,\"12.5\"]]", Json(a[0].Changed));
        Assert.Equal([1], a[1].Touched);
        Assert.Equal([1, 50], a[2].TouchedAged);
        Assert.True(a[0].Seq < a[1].Seq && a[1].Seq < a[2].Seq);
    }

    [Fact]
    public async Task OldSeqIsDroppedAndANewEpochResetsTheCache()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.SetInterestAsync("a", Car, [1, 2]);
        await _relay.OnDeltaAsync(Car, Delta(5, changed: [(1, "a", TelemetrySampleState.Valid)]));
        await _relay.OnDeltaAsync(Car, Delta(5, changed: [(1, "b", TelemetrySampleState.Valid)]));
        await _relay.OnDeltaAsync(Car, Delta(4, changed: [(1, "c", TelemetrySampleState.Valid)]));
        Assert.Single(_out.Samples);
        await _relay.OnDeltaAsync(Car, Delta(0, changed: [(2, "x", TelemetrySampleState.Valid)], epoch: "e2"));
        await _relay.SetInterestAsync("late", Car, [1, 2]);
        var snapshot = _out.Samples.Single(s => s.Connection == "late");
        Assert.Equal([2], snapshot.Changed.Select(c => (int)c[0]));
    }

    [Fact]
    public async Task NewInterestGetsASnapshotWithOwnAges()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.OnDeltaAsync(Car, Delta(0, 30, [(1, "1", TelemetrySampleState.Valid), (2, "2", TelemetrySampleState.Stale)]));
        await Task.Delay(50);
        await _relay.SetInterestAsync("a", Car, [1, 2, 9]);
        var snapshot = _out.Samples.Single();
        Assert.Equal(2, snapshot.Changed.Length);
        Assert.All(snapshot.Changed, c => Assert.Equal(4, c.Length));
        Assert.InRange((int)snapshot.Changed[0][3], 70, 2000);
        Assert.Equal((int)TelemetrySampleState.Stale, (int)snapshot.Changed[1][2]);
        await _relay.SetInterestAsync("a", Car, [1, 2, 9]);
        Assert.Single(_out.Samples);
    }

    [Fact]
    public async Task LegacyOnboardValuesAreUncheckedAndConfirmedSparingly()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.SetInterestAsync("a", Car, [1]);
        await _relay.AddLegacyClientAsync("old", Car);
        await _relay.OnLegacyValueAsync(Car, "speed", "1.0");
        await _relay.OnLegacyValueAsync(Car, "speed", "1.0");
        await _relay.OnLegacyValueAsync(Car, "unknown", "x");
        var a = _out.Samples.Where(s => s.Connection == "a").ToList();
        Assert.Single(a);
        Assert.Equal("[[1,\"1.0\",1]]", Json(a[0].Changed));
        Assert.Equal([("speed", "1.0")], _out.Legacy.Select(l => (l.Name, l.Value)));
        await Task.Delay(300);
        await _relay.OnLegacyValueAsync(Car, "speed", "1.0");
        Assert.Equal([1], _out.Samples.Last(s => s.Connection == "a").Touched);
        Assert.Single(_out.Legacy);
    }

    [Fact]
    public async Task LegacyClientsDemandAllChannelsAndGetNoNoData()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.AddLegacyClientAsync("old", Car);
        await Task.Delay(400);
        Assert.Equal([1, 2], _out.Demands[^1].Ids);
        await _relay.OnDeltaAsync(Car, Delta(0, changed: [(1, "", TelemetrySampleState.NoData), (2, "11.2", TelemetrySampleState.Valid)]));
        Assert.Equal([("volt", "11.2")], _out.Legacy.Select(l => (l.Name, l.Value)));
    }

    [Fact]
    public async Task OnboardDisconnectDropsTheCache()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.OnDeltaAsync(Car, Delta(0, changed: [(1, "1", TelemetrySampleState.Valid)]));
        await _relay.ConnectionClosedAsync("onboard");
        await _relay.SetInterestAsync("a", Car, [1]);
        Assert.Empty(_out.Samples);
    }

    [Fact]
    public void ConnectionStoreKnowsOnlyTheCurrentOnboardConnection()
    {
        var store = new CarConnectionStore();
        store.RegisterConnection("7", "old");
        store.RegisterConnection("7", "new");
        Assert.False(store.TryGetCarId("old", out _));
        Assert.True(store.TryGetCarId("new", out var car));
        Assert.Equal(7, car);
        Assert.False(store.TryGetCarId("browser", out _));
    }

    private static string Json(object[][] value) => System.Text.Json.JsonSerializer.Serialize(value);

    private sealed class FakeDirectory : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [1] = "speed", [2] = "volt" });
    }

    private sealed class FakeTransport : ITelemetryTransport
    {
        public readonly List<(string Connection, long Seq, int Age, object[][] Changed, int[] Touched, int[] TouchedAged)> Samples = [];
        public readonly List<(string Name, string Value)> Legacy = [];
        public readonly List<(string Onboard, int[] Ids)> Demands = [];

        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged)
        {
            lock (this) Samples.Add((connectionId, seq, ageMs, changed, touched, touchedAged));
            return Task.CompletedTask;
        }

        public Task SendLegacyAsync(int carId, string channelName, string value)
        {
            lock (this) Legacy.Add((channelName, value));
            return Task.CompletedTask;
        }

        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds)
        {
            lock (this) Demands.Add((onboardConnectionId, channelIds));
            return Task.CompletedTask;
        }
    }
}
