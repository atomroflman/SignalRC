using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Server.Data;
using SignalRC.Server.Telemetry;
using SignalRC.Server.Telemetry.History;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

public class TelemetryThrottleTests
{
    private static List<(long, double)> Offer(TelemetryThrottle t, long time, double value, bool touched = false)
    {
        var rows = new List<(long Time, double Value)>();
        t.Offer(1, time, value, touched, rows);
        return rows.Select(r => (r.Time, r.Value)).ToList();
    }

    [Fact]
    public void WritesAtMostEvery100MsAndKeepsTheLastValueOfABurst()
    {
        var t = new TelemetryThrottle();
        Assert.Equal([(1000L, 1.0)], Offer(t, 1000, 1));
        Assert.Empty(Offer(t, 1030, 2));
        Assert.Empty(Offer(t, 1060, 3));
        Assert.Empty(t.Flush(1090));
        Assert.Equal([(1, 1060L, 3.0)], t.Flush(1100));
        Assert.Empty(t.Flush(2000));
        Assert.Equal([(1200L, 4.0)], Offer(t, 1200, 4));
    }

    [Fact]
    public void APeakWithinAnIntervalIsKeptAndTheNewestValueFollows()
    {
        var t = new TelemetryThrottle();
        Offer(t, 0, 10);
        Assert.Empty(Offer(t, 30, 50));
        Assert.Empty(Offer(t, 60, 12));
        Assert.Equal([(1, 30L, 50.0)], t.Flush(100));
        Assert.Empty(t.Flush(190));
        Assert.Equal([(1, 60L, 12.0)], t.Flush(200));
    }

    [Fact]
    public void ANewSampleAfterTheIntervalWritesThePendingOnesFirst()
    {
        var t = new TelemetryThrottle();
        Offer(t, 0, 10);
        Offer(t, 20, 90);
        Offer(t, 40, 11);
        // One row per interval: the peak now, then 11 (further from 90 than 11.5), then the newest.
        Assert.Equal([(20L, 90.0)], Offer(t, 140, 11.5));
        Assert.Empty(t.Flush(200));
        Assert.Equal([(1, 40L, 11.0)], t.Flush(240));
        Assert.Equal([(1, 140L, 11.5)], t.Flush(340));
        Assert.Empty(t.Flush(1000));
    }

    [Fact]
    public void ConfirmedValueIsRepeatedOncePerSecond()
    {
        var t = new TelemetryThrottle();
        Offer(t, 0, 5);
        Assert.Empty(Offer(t, 500, 5, true));
        Assert.Equal([(1000L, 5.0)], Offer(t, 1000, 5, true));
        Assert.Empty(Offer(t, 1500, 5, true));
    }

    [Fact]
    public void ConfirmingAPendingValueKeepsItsTime()
    {
        var t = new TelemetryThrottle();
        Offer(t, 0, 1);
        Assert.Empty(Offer(t, 50, 2));
        Assert.Empty(Offer(t, 80, 2, true));
        Assert.Equal([(1, 50L, 2.0)], t.Flush(200));
    }

    [Fact]
    public void GapsAreKeptAndTimeNeverGoesBack()
    {
        var t = new TelemetryThrottle();
        Offer(t, 1000, 1);
        Assert.Empty(Offer(t, 900, double.NaN));
        Assert.Empty(Offer(t, 1050, 1.5));
        var rows = t.Flush(1200);
        Assert.Single(rows);
        Assert.Equal(1001, rows[0].Time);
        Assert.True(double.IsNaN(rows[0].Value));
    }

    [Theory]
    [InlineData("12.5", TelemetrySampleState.Valid, TelemetryDataType.Number, 12.5)]
    [InlineData("3", TelemetrySampleState.Unchecked, TelemetryDataType.Integer, 3)]
    [InlineData("true", TelemetrySampleState.Valid, TelemetryDataType.Boolean, 1)]
    [InlineData("0", TelemetrySampleState.Valid, TelemetryDataType.Boolean, 0)]
    public void ParsesRecordableValues(string text, TelemetrySampleState state, TelemetryDataType type, double expected)
    {
        Assert.Equal(expected, TelemetryRecorder.Parse(text, state, type));
    }

    [Theory]
    [InlineData("12.5", TelemetrySampleState.Stale, TelemetryDataType.Number)]
    [InlineData("12.5", TelemetrySampleState.NoData, TelemetryDataType.Number)]
    [InlineData("abc", TelemetrySampleState.Valid, TelemetryDataType.Number)]
    [InlineData("12,5", TelemetrySampleState.Valid, TelemetryDataType.Number)]
    [InlineData("yes", TelemetrySampleState.Valid, TelemetryDataType.Boolean)]
    public void UnusableValuesBecomeGaps(string text, TelemetrySampleState state, TelemetryDataType type)
    {
        Assert.True(double.IsNaN(TelemetryRecorder.Parse(text, state, type)));
    }

    [Fact]
    public void SessionChannelsMergeWithTheCurrentMetadataWinning()
    {
        var json = TelemetryRecorder.Merge("[]", [new TelemetrySessionChannel(1, "speed", TelemetryDataType.Number, "km/h", 1)]);
        json = TelemetryRecorder.Merge(json, [new TelemetrySessionChannel(1, "speed", TelemetryDataType.Number, "m/s", 2), new TelemetrySessionChannel(2, "volt", TelemetryDataType.Number, "V", 2)]);
        var channels = TelemetryRecorder.ReadChannels(json);
        Assert.Equal(["speed", "volt"], channels.Select(c => c.Name));
        Assert.Equal("m/s", channels[0].Unit);
    }
}

public class TextThrottleTests
{
    private static List<(long, string?)> Offer(TextThrottle t, long time, string? value)
    {
        var rows = new List<(long Time, string? Value)>();
        t.Offer(1, time, value, rows);
        return rows.Select(r => (r.Time, r.Value)).ToList();
    }

    [Fact]
    public void StoresOnlyChanges()
    {
        var t = new TextThrottle();
        Assert.Equal([(0L, (string?)"idle")], Offer(t, 0, "idle"));
        Assert.Empty(Offer(t, 500, "idle"));
        Assert.Equal([(1000L, (string?)"drive")], Offer(t, 1000, "drive"));
        Assert.Equal([(2000L, (string?)null)], Offer(t, 2000, null));
        Assert.Empty(Offer(t, 2500, null));
        Assert.Empty(t.Flush(5000));
    }

    [Fact]
    public void FlappingKeepsTheNewestStateAtTenPerSecond()
    {
        var t = new TextThrottle();
        Offer(t, 0, "a");
        Assert.Empty(Offer(t, 20, "b"));
        Assert.Empty(Offer(t, 40, "c"));
        Assert.Empty(t.Flush(90));
        Assert.Equal([(1, 40L, (string?)"c")], t.Flush(100));
        // back and forth within an interval: no change at all
        Assert.Empty(Offer(t, 150, "d"));
        Assert.Empty(Offer(t, 160, "c"));
        Assert.Empty(t.Flush(1000));
        // a pending change is written first when the next one arrives after the interval
        Assert.Equal([(1100L, (string?)"e")], Offer(t, 1100, "e"));
        Assert.Empty(Offer(t, 1150, "f"));
        Assert.Equal([(1150L, (string?)"f")], Offer(t, 1250, "f"));
    }

    [Theory]
    [InlineData("RUN", TelemetrySampleState.Valid, "RUN")]
    [InlineData("RUN", TelemetrySampleState.Stale, null)]
    public void ParsesText(string text, TelemetrySampleState state, string? expected)
    {
        Assert.Equal(expected, TelemetryRecorder.ParseText(text, state));
        Assert.Equal(200, TelemetryRecorder.ParseText(new string('x', 500), TelemetrySampleState.Valid)!.Length);
    }

    [Fact]
    public void EverythingButLidarIsRecordable()
    {
        Assert.True(TelemetryRecorder.IsRecordable(TelemetryDataType.String));
        Assert.False(TelemetryRecorder.IsRecordable(TelemetryDataType.LidarGrid));
    }
}

public class TelemetryRelaySinkTests
{
    private const int Car = 3;

    private static TelemetryDelta Delta(long seq, (int Id, string Value)[]? changed = null, int[]? touched = null) => new()
    {
        Epoch = "e", Seq = seq, AgeMs = 20,
        Changed = (changed ?? []).Select(c => new TelemetryChange { Id = c.Id, Value = c.Value, State = TelemetrySampleState.Valid }).ToList(),
        Touched = touched ?? [], TouchedAged = [],
    };

    [Fact]
    public async Task RecordedChannelsAreDemandedAndHandedToTheSink()
    {
        var transport = new Transport();
        var sink = new Sink([2]);
        var relay = new TelemetryRelay(transport, new Directory(), TimeProvider.System, NullLogger<TelemetryRelay>.Instance, sink: sink);

        await relay.OnboardConnectedAsync(Car, "onboard");
        Assert.Equal([2], transport.Demands[^1]);

        await relay.OnDeltaAsync(Car, Delta(0, [(1, "5"), (2, "7")]));
        await relay.OnDeltaAsync(Car, Delta(1, touched: [1, 2]));
        Assert.Equal([(2, "7", false), (2, "7", true)], sink.Samples.Select(s => (s.Id, s.Value, s.Touched)));
        Assert.All(sink.Samples, s => Assert.Equal(20, s.AgeMs));

        await relay.SetRecordedAsync(Car, []);
        await Task.Delay(400);
        Assert.Empty(transport.Demands[^1]);

        await relay.ConnectionClosedAsync("onboard");
        Assert.Equal(1, sink.Disconnects);
    }

    private sealed class Sink(int[] recorded) : ITelemetrySink
    {
        public readonly List<RecordedSample> Samples = [];
        public int Disconnects;
        public Task<IReadOnlyCollection<int>> OnboardConnectedAsync(int carId) => Task.FromResult<IReadOnlyCollection<int>>(recorded);
        public void OnboardDisconnected(int carId) => Disconnects++;
        public void OnSamples(int carId, DateTime receivedUtc, IReadOnlyList<RecordedSample> samples) => Samples.AddRange(samples);
    }

    private sealed class Directory : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [1] = "speed", [2] = "volt" });
    }

    private sealed class Transport : ITelemetryTransport
    {
        public readonly List<int[]> Demands = [];
        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) => Task.CompletedTask;
        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds)
        {
            lock (Demands) Demands.Add(channelIds);
            return Task.CompletedTask;
        }
    }
}
