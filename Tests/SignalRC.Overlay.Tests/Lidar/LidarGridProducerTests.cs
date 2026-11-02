using System.Reflection;
using System.Text.Json;
using MessagePack;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Server.Overlay.Lidar;
using SignalRC.Shared.Telemetry;
using static SignalRC.Overlay.Tests.Lidar.LidarTestData;

namespace SignalRC.Overlay.Tests.Lidar;

public class LidarGridProducerTests
{
    private static readonly DateTime T0 = new(2026, 11, 2, 12, 0, 0, DateTimeKind.Utc);
    private readonly LidarGridProducer _producer = new(LidarGridOptions.Default);

    private static int[] Obstacle(int mm) => Run(100, 6, mm);

    [Fact]
    public void NoDataBeforeTheFirstScanThenNothing()
    {
        var first = _producer.Next(Healthy with { ScanAgeSeconds = double.PositiveInfinity }, null, T0);
        Assert.Equal(new TelemetrySample("", TelemetrySampleState.NoData, 0), first);
        Assert.Null(_producer.Next(Healthy, null, T0.AddMilliseconds(100)));
    }

    [Fact]
    public void EachScanIsProcessedOnceAndAgesFromItsReceiveTime()
    {
        var scan = Scan(Obstacle(1000), 7, receivedUtc: T0);
        var s = _producer.Next(Healthy, scan, T0.AddMilliseconds(40))!.Value;
        Assert.Equal(TelemetrySampleState.Valid, s.State);
        Assert.Equal(40, s.AgeMs);
        Assert.StartsWith("11s:", s.Value);
        // Same scan again: no sample, so no confirmation and the age keeps growing.
        Assert.Null(_producer.Next(Healthy, scan, T0.AddMilliseconds(140)));
        // A Pico restart may repeat a sequence number; a new receive time is a new scan.
        Assert.NotNull(_producer.Next(Healthy, Scan(Obstacle(1000), 7, receivedUtc: T0.AddMilliseconds(200)), T0.AddMilliseconds(210)));
    }

    [Fact]
    public void DeadbandRepeatsTheSentValue()
    {
        var sent = _producer.Next(Healthy, Scan(Obstacle(1500), 1, receivedUtc: T0), T0)!.Value.Value;
        // 1520 mm is 152 cm, 2 cm off: unchanged.
        Assert.Equal(sent, _producer.Next(Healthy, Scan(Obstacle(1520), 2, receivedUtc: T0), T0)!.Value.Value);
        // Compared with the last sent grid, not the last seen: 1525 → 153 cm is 3 cm off 150.
        var moved = _producer.Next(Healthy, Scan(Obstacle(1525), 3, receivedUtc: T0), T0)!.Value.Value;
        Assert.NotEqual(sent, moved);
        // Occupancy and completeness changes always go out.
        Assert.NotEqual(moved, _producer.Next(Healthy, Scan(Run(100, 6, 1525, Run(900, 3, 700)), 4, receivedUtc: T0), T0)!.Value.Value);
        var complete = _producer.Value;
        Assert.NotEqual(complete, _producer.Next(Healthy, Scan(Run(100, 6, 1525, Run(900, 3, 700)), 5, complete: false, receivedUtc: T0), T0)!.Value.Value);
    }

    [Fact]
    public void StateChangesWithoutScanGoOutOnce()
    {
        var value = _producer.Next(Healthy, Scan(Obstacle(1000), 1, receivedUtc: T0), T0)!.Value.Value;

        var stalled = Healthy with { Spinning = false, ScanAgeSeconds = 3 };
        Assert.Equal(new TelemetrySample(value, TelemetrySampleState.Stale, 3000), _producer.Next(stalled, null, T0.AddSeconds(3)));
        Assert.Null(_producer.Next(stalled, null, T0.AddSeconds(4)));

        var closed = stalled with { PortOpen = false };
        Assert.Equal(TelemetrySampleState.Error, _producer.Next(closed, null, T0.AddSeconds(5))!.Value.State);
        Assert.Null(_producer.Next(closed, null, T0.AddSeconds(6)));

        var problem = Healthy with { Problem = "no revolution" };
        Assert.Equal(TelemetrySampleState.Error, new LidarGridProducer(LidarGridOptions.Default).Next(problem, Scan(Obstacle(1000), 1), T0)!.Value.State);
    }

    [Fact]
    public void DeadbandBecomesAConfirmationInTheDeltaTracker()
    {
        var tracker = new TelemetryDeltaTracker("e");
        tracker.SetDemand([42]);
        var noise = new[] { 1500, 1510, 1490, 1505, 1495, 1500, 1512, 1488 };
        var full = 0;
        var confirmed = 0;
        for (var i = 0; i < noise.Length; i++)
        {
            var now = T0.AddMilliseconds(i * 200);
            var sample = _producer.Next(Healthy, Scan(Obstacle(noise[i]), (uint)i, receivedUtc: now), now);
            if (sample is not { } s) continue;
            var delta = tracker.Tick(new Dictionary<int, TelemetrySample> { [42] = s }, i * 200);
            full += delta?.Changed.Count ?? 0;
            confirmed += delta?.Touched.Length + delta?.TouchedAged.Length / 2 ?? 0;
        }
        // Ticks every 200 ms, confirmations at most every 250 ms: at 400, 800 and 1200 ms.
        Assert.Equal(1, full);
        Assert.Equal(3, confirmed);
    }

    [Fact]
    public void DataBudget()
    {
        // Sparse is never longer than dense, and dense is the upper bound.
        for (var occupied = 0; occupied <= 480; occupied++)
        {
            var grid = new LidarGrid { Complete = true };
            for (var f = 0; f < occupied; f++) grid.Mm[f] = 1234;
            var value = LidarGridWire.Encode(grid);
            Assert.True(value.Length <= 4 + 1280, $"{occupied}: {value.Length}");
            Assert.Equal(occupied <= 239 ? 's' : 'd', value[2]);
        }

        // Driving: about 60 occupied fields at 5 Hz is about 1.6 kB/s of values (≤ 2 kB/s).
        var driving = new LidarGrid { Complete = true };
        for (var f = 0; f < 60; f++) driving.Mm[f * 8] = (ushort)(800 + f);
        Assert.True(LidarGridWire.Encode(driving).Length * 5 <= 2000);

        // Dense at 5 Hz: 6.4 kB/s of values (≤ 7 kB/s).
        Assert.True(LidarGridWire.Encode(new LidarGrid { Complete = true }.Fill(480)).Length * 5 <= 7000);

        // Standstill: confirmations only. One touched id per tick, at most 4/s
        // (250 ms), is a few bytes on the MessagePack uplink.
        var touch = new TelemetryDelta { Epoch = "abcd1234", Seq = 1000, AgeMs = 40, Touched = [42] };
        Assert.True(MessagePackSerializer.Serialize(touch).Length * 4 <= 300);
    }

    // --- Reader ---

    [Fact]
    public async Task ReaderUsesTheRawScanNotTheFilteredOne()
    {
        var source = new FakeLidarSource
        {
            Health = Healthy,
            LatestRawScan = Scan(Obstacle(1000), 1),
            LatestScan = Scan(Points(), 1),
        };
        var reader = new LidarGridTelemetryReader(NullLogger<LidarGridTelemetryReader>.Instance, new FakeModuleFactory(source));
        var samples = await reader.ReadAllSamplesAsync("lidarGrid");
        Assert.True(LidarGridWire.TryDecode(samples!["lidarGrid"].Value, out var cm, out _));
        // Raw indices 100..105 (25°..26.25°) land in cells 6 and 7, zone 1, 100 cm.
        Assert.Equal(100, cm[6 * 5 + 1]);
        Assert.Equal(100, cm[7 * 5 + 1]);
    }

    [Fact]
    public async Task ReaderReportsInvalidOptionsOnceAsError()
    {
        var source = new FakeLidarSource { Health = Healthy, LatestRawScan = Scan(Obstacle(1000), 1) };
        var reader = new LidarGridTelemetryReader(NullLogger<LidarGridTelemetryReader>.Instance, new FakeModuleFactory(source))
        {
            ZoneLimitsMm = [500, 400, 2000, 3000, 5000],
        };
        var first = await reader.ReadAllSamplesAsync("grid");
        Assert.Equal(TelemetrySampleState.Error, first!["grid"].State);
        Assert.Equal(TelemetrySampleState.Error, first["lidarGrid"].State);
        Assert.Null(await reader.ReadAllSamplesAsync("grid"));
        Assert.Null(await reader.ReadAllTelemetryAsync("grid"));
    }

    [Fact]
    public void ProvisionedOptionsBindToReaderProperties()
    {
        // The onboard sets options by case-insensitive property name (TelemetryService.CreateReader).
        var type = typeof(LidarGridTelemetryReader);
        Assert.Equal(LidarGridSourceService.ReaderType, type.FullName);
        Assert.True(type.FullName!.Length <= 64);
        var json = JsonSerializer.Serialize(LidarGridSourceService.DefaultOptions("lidar"));
        var options = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
        var reader = new LidarGridTelemetryReader(NullLogger<LidarGridTelemetryReader>.Instance, new FakeModuleFactory(new FakeLidarSource()));
        foreach (var (key, value) in options.Where(o => o.Key != "groupKey"))
        {
            var property = type.GetProperty(key, BindingFlags.IgnoreCase | BindingFlags.Public | BindingFlags.Instance);
            Assert.NotNull(property);
            property!.SetValue(reader, value.Deserialize(property.PropertyType));
        }
        Assert.Equal(LidarGridOptions.Default with { ZoneLimitsMm = reader.ZoneLimitsMm }, reader.Options);
        Assert.Equal(LidarGridOptions.Default.ZoneLimitsMm, reader.ZoneLimitsMm);
    }
}

internal static class GridExtensions
{
    public static LidarGrid Fill(this LidarGrid grid, int fields)
    {
        for (var f = 0; f < fields; f++) grid.Mm[f] = 3000;
        return grid;
    }
}
