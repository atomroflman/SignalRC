using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Relay;

/// <summary>Messages and bytes per second of the relay (telemetry/README.md §5 "Diagnose").</summary>
public class TelemetryTrafficTests
{
    private const int Car = 5;
    private readonly ManualTime _time = new();
    private readonly CapturingLoggers _loggers = new();
    private readonly TelemetryRelay _relay;

    public TelemetryTrafficTests()
    {
        _relay = new TelemetryRelay(new NullTransport(), new Names(), _time, NullLogger<TelemetryRelay>.Instance, _loggers);
    }

    private static TelemetryDelta Delta(long seq, params (int Id, string Value)[] changed) => new()
    {
        Epoch = "e1", Seq = seq, AgeMs = 10,
        Changed = changed.Select(c => new TelemetryChange { Id = c.Id, Value = c.Value }).ToList(),
        Touched = [2],
    };

    [Fact]
    public void RateWindowCountsTheLastFiveSecondsAndScalesPartlyMeasuredBytes()
    {
        var w = new RateWindow();
        // 10 messages per second for 8 s, measured (100 B, 300 B real) only from 6 s on.
        for (var t = 0L; t < 8000; t += 100) w.Add(t, t >= 6000 ? 100 : -1, t >= 6000 ? 300 : -1);
        var r = w.Rate(7999, 0);
        Assert.InRange(r.PerSecond, 9.5, 10.1);
        Assert.InRange(r.BytesPerSecond!.Value, r.PerSecond * 100 - 1, r.PerSecond * 100 + 1);
        Assert.InRange(r.RealBytesPerSecond!.Value, r.PerSecond * 300 - 2, r.PerSecond * 300 + 2);
        Assert.Equal(new TrafficTotal(80, 20, 2000, 6000), r.Total);

        // Right after the start the span is the time since then (at least 1 s).
        var fresh = new RateWindow();
        fresh.Add(1000);
        fresh.Add(1500);
        Assert.Equal(2, fresh.Rate(2000, 1000).PerSecond);
        Assert.Equal(1, fresh.Rate(2000, 0).PerSecond);
        Assert.Null(fresh.Rate(2000, 0).BytesPerSecond);
        // Old messages fall out of the window.
        Assert.Equal(0, fresh.Rate(20_000, 0).PerSecond);
    }

    [Fact]
    public void FramesHaveTheLengthOfTheHubProtocols()
    {
        var json = "{\"type\":1,\"target\":\"Tlm\",\"arguments\":[7,3,10,[[1,\"12.5\"]],[2],[]]}\u001e";
        Assert.Equal(Encoding.UTF8.GetByteCount(json), TelemetryTraffic.TlmJsonBytes(7, 3, 10, [[1, "12.5"]], [2], []));

        var small = TelemetryTraffic.MessagePackBytes(Delta(1, (1, "1")));
        var large = TelemetryTraffic.MessagePackBytes(Delta(1, (1, new string('x', 1000))));
        Assert.InRange(small, 20, 80);
        Assert.InRange(large - small, 1000, 1004);

        var real = TelemetryTraffic.RealJsonBytes([new(1, "speed", "12.5", TelemetrySampleState.Valid, 10)]);
        Assert.Equal("[{\"id\":1,\"name\":\"speed\",\"value\":\"12.5\",\"state\":\"Valid\",\"ageMs\":10}]".Length, real);
    }

    [Fact]
    public async Task BytesAreMeasuredOnlyWhileTheEndpointIsWatched()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.SetInterestAsync("viewer-a", Car, [1, 2]);
        await _relay.SetInterestAsync("viewer-b", Car, [1]);
        for (var seq = 0; seq < 5; seq++)
        {
            await _relay.OnDeltaAsync(Car, Delta(seq, (1, "v" + seq), (2, "w")));
            _time.Advance(TimeSpan.FromMilliseconds(100));
        }
        var unwatched = _relay.Snapshot(Car).Traffic;
        Assert.Equal((5L, 0L), (unwatched.Incoming.Total.Messages, unwatched.Incoming.Total.MeasuredMessages));
        Assert.Equal((10L, 0L), (unwatched.Outgoing.Total.Messages, unwatched.Outgoing.Total.MeasuredMessages));
        Assert.Null(unwatched.Incoming.BytesPerSecond);

        // The snapshot above switched measuring on.
        var delta = Delta(5, (1, "measured"));
        await _relay.OnDeltaAsync(Car, delta);
        var watched = _relay.Snapshot(Car).Traffic;
        Assert.True(watched.Measuring);
        Assert.Equal(TelemetryTraffic.MessagePackBytes(delta), watched.Incoming.Total.Bytes);
        Assert.Equal(TelemetryTraffic.RealJsonBytes([
            new(1, "speed", "measured", TelemetrySampleState.Valid, 10),
            new(2, "volt", "w", TelemetrySampleState.Valid, 10),
        ]), watched.Incoming.Total.RealBytes);
        Assert.Equal(2, watched.Outgoing.Total.MeasuredMessages);
        Assert.True(watched.Outgoing.RealBytesPerSecond > watched.Outgoing.BytesPerSecond);

        // Two anonymous clients, busiest first; a closed connection is forgotten.
        Assert.Equal([6L, 6L], watched.Clients.Select(c => c.Messages));
        Assert.DoesNotContain("viewer", System.Text.Json.JsonSerializer.Serialize(watched));
        await _relay.ConnectionClosedAsync("viewer-b");
        Assert.Single(_relay.Snapshot(Car).Traffic.Clients);

        // Without another look at the endpoint measuring stops after 30 s.
        _time.Advance(TelemetryTraffic.WatchTimeout);
        await _relay.OnDeltaAsync(Car, Delta(6, (1, "late")));
        Assert.Equal(1, _relay.Snapshot(Car).Traffic.Incoming.Total.MeasuredMessages);
    }

    [Fact]
    public async Task TheLogMeasuresOneSampleDeltaPerSummary()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        for (var seq = 0; seq < 30; seq++)
        {
            await _relay.OnDeltaAsync(Car, Delta(seq, (1, "x")));
            _time.Advance(TimeSpan.FromMilliseconds(200));
        }
        var traffic = _loggers.Entries.Where(e => e.Category == TelemetryRelayLog.Category && e.Message.Contains("traffic:")).ToList();
        // Summaries at 0 s and 5 s; the endpoint was never asked, so Tlm bytes are not measured.
        Assert.Equal(2, traffic.Count);
        Assert.Contains($"sample delta {TelemetryTraffic.MessagePackBytes(Delta(25, (1, "x")))} B MessagePack", traffic[1].Message);
        Assert.Contains("not measured", traffic[1].Message);
        var rate = double.Parse(System.Text.RegularExpressions.Regex.Match(traffic[1].Message, @"in ([\d.]+) deltas/s").Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        Assert.InRange(rate, 4.5, 5.5);
        Assert.Equal(0, _relay.Snapshot(Car).Traffic.Incoming.Total.MeasuredMessages);
    }

    private sealed class ManualTime : TimeProvider
    {
        private long _ticks = 1_000_000;
        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);
        public override long GetTimestamp() => Interlocked.Read(ref _ticks);
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    }

    private sealed class Names : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [1] = "speed", [2] = "volt" });
    }

    private sealed class NullTransport : ITelemetryTransport
    {
        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) => Task.CompletedTask;
        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }
}
