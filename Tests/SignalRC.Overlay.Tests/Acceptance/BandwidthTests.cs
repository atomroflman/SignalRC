using System.Buffers;
using System.Globalization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Protocol;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Grid = SignalRC.Onboard.Telemetry.LidarGrid.LidarGrid;
using SignalRC.Onboard.Telemetry;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Overlay.Tests.Lidar;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;
using Xunit.Abstractions;

namespace SignalRC.Overlay.Tests.Acceptance;

/// <summary>
/// AP14 / S09: data volume per viewer for reference HUD R2, measured on the
/// real path onboard DeltaTracker + LidarGridProducer → TelemetryRelay /
/// ControlDisplayRelay → SignalR JSON hub protocol (+ websocket frame header).
/// The uplink is measured with the MessagePack hub protocol. 60 s simulated,
/// onboard tick 100 ms (Onboard/Program.cs), LiDAR every 2nd tick (5 Hz, D16).
/// </summary>
public class BandwidthTests(ITestOutputHelper output)
{
    private const int Car = 11;
    private const int Seconds = 60;
    private const int TickMs = 100;

    // R2 (fixtures/documents/valid/reference-r2-typical.json): 7 telemetry channels, lidarGrid, out("steering").
    private static readonly string[] Numeric = ["odoHeading", "pitch", "roll", "leftSpeed", "rightSpeed", "odoSpeed", "batteryVoltage"];
    private const int LidarId = 8;
    private const int Steering = 101, Throttle = 102;

    private sealed record Result(double TlmBps, double LidarBps, double CtlBps, double UplinkBps, int Messages, int LidarFields)
    {
        public double Total => TlmBps + CtlBps;
    }

    private enum Scene { Drive, Standstill }
    private enum Lidar { Sparse, Dense }

    [Fact]
    public async Task DriveStaysWithinTheViewerBudget()
    {
        var r = await RunAsync(Scene.Drive, Lidar.Sparse);
        Report("R2 Fahrt, LiDAR dünn (~60 Felder)", r);
        Assert.InRange(r.LidarFields, 55, 65);
        Assert.True(r.Total <= 6000, $"gesamt {r.Total:0} B/s > 6000");
        Assert.True(r.LidarBps <= 3000, $"LiDAR {r.LidarBps:0} B/s > 3000");
    }

    [Fact]
    public async Task StandstillStaysWithinTheViewerBudget()
    {
        var r = await RunAsync(Scene.Standstill, Lidar.Sparse);
        Report("R2 Stillstand", r);
        Assert.True(r.CtlBps > 0, "Keepalive fehlt");
        Assert.True(r.Total <= 1500, $"gesamt {r.Total:0} B/s > 1500");
    }

    /// <summary>Dense grids are not part of the S09 drive budget (≈60 fields); reported for the acceptance document.</summary>
    [Fact]
    public async Task DenseLidarIsReported()
    {
        var r = await RunAsync(Scene.Drive, Lidar.Dense);
        Report("R2 Fahrt, LiDAR dicht (480 Felder)", r);
        Assert.True(r.LidarFields > LidarGridWire.MaxSparseFields);
        // T01: 960 bytes → 1280 base64 chars per snapshot, 5 Hz → ≥ 6400 B/s. Keep it below 8 kB/s.
        Assert.InRange(r.LidarBps, 6400, 8000);
    }

    [Fact]
    public async Task WithoutDemandNothingIsSentEvenOnTheUplink()
    {
        var r = await RunAsync(Scene.Drive, Lidar.Sparse, demand: false);
        Report("ohne Bedarf", r);
        Assert.Equal(0, r.Messages);
        Assert.Equal(0, r.UplinkBps);
    }

    private void Report(string name, Result r) =>
        output.WriteLine(string.Create(CultureInfo.InvariantCulture,
            $"{name}: Tlm {r.TlmBps:0} B/s (davon LiDAR {r.LidarBps:0}), Ctl {r.CtlBps:0} B/s, gesamt {r.Total:0} B/s; Uplink {r.UplinkBps:0} B/s; {r.Messages} Nachrichten, {r.LidarFields} belegte LiDAR-Felder"));

    private async Task<Result> RunAsync(Scene scene, Lidar lidar, bool demand = true)
    {
        var transport = new Capture();
        var names = Numeric.Select((n, i) => (Id: i + 1, n)).Append((LidarId, "lidarGrid")).ToDictionary(x => x.Item1, x => x.Item2);
        var relay = new TelemetryRelay(transport, new ChannelNames(names), TimeProvider.System, NullLogger<TelemetryRelay>.Instance);
        var ctl = new ControlDisplayRelay(transport, TimeProvider.System, NullLogger<ControlDisplayRelay>.Instance);

        await relay.OnboardConnectedAsync(Car, "onboard");
        await ctl.ControlAcquiredAsync(Car, "driver");
        if (demand)
        {
            await relay.SetInterestAsync("viewer", Car, names.Keys);
            await ctl.SetInterestAsync("viewer", Car, true);
        }
        await Task.Delay(450); // demand coalescing (≤ every 200 ms)
        var tracker = new TelemetryDeltaTracker("ep01");
        if (transport.Demands.LastOrDefault().Ids is { } ids) tracker.SetDemand(ids);
        var ctlNeeded = transport.CtlDemand.LastOrDefault();
        transport.ResetCounters();

        var producer = new LidarGridProducer(new LidarGridOptions());
        long uplink = 0;
        var mp = new MessagePackHubProtocol();
        long ctlSeq = 0, lastCtlAt = -1000;
        var fields = 0;
        var start = new DateTime(2026, 11, 2, 12, 0, 0, DateTimeKind.Utc);
        for (var tick = 0; tick < Seconds * 1000 / TickMs; tick++)
        {
            var nowMs = (long)tick * TickMs;
            var t = nowMs / 1000.0;
            var moving = scene == Scene.Drive;
            var read = new Dictionary<int, TelemetrySample>();
            for (var i = 0; i < Numeric.Length; i++)
            {
                var v = moving ? 10 + i + 5 * Math.Sin(t * 0.7 + i) : 10 + i;
                read[i + 1] = TelemetrySample.Valid(v.ToString("0.00", CultureInfo.InvariantCulture), 20);
            }
            if (tick % 2 == 0)
            {
                var scan = LidarTestData.Scan(Scan(lidar, moving ? t : 0), (uint)(tick / 2 + 1), receivedUtc: start.AddMilliseconds(nowMs));
                if (producer.Next(LidarTestData.Healthy, scan, start.AddMilliseconds(nowMs + 30)) is { } s)
                {
                    read[LidarId] = s;
                    if (fields == 0 && LidarGridWire.TryDecode(s.Value, out var cm, out _)) fields = cm.Count(v => v != Grid.Empty);
                }
            }
            if (tracker.Tick(read, nowMs) is { } delta)
            {
                uplink += Frame(mp, new InvocationMessage("UpdateTelemetrySamples", [delta]));
                await relay.OnDeltaAsync(Car, delta);
            }

            // Driver page: ≤ 10 Hz on change, keepalive every 1 s (D31), only while needed (D59).
            if (ctlNeeded)
            {
                var due = moving || nowMs - lastCtlAt >= 1000;
                if (due)
                {
                    (int, double)[] outputs = moving ? [(Steering, Math.Round(Math.Sin(t), 3)), (Throttle, Math.Round(0.4 + 0.1 * Math.Cos(t), 3))] : [];
                    if (ctlSeq == 0) outputs = [(Steering, 0.0), (Throttle, 0.0)];
                    await ctl.PublishAsync("driver", Car, ++ctlSeq, false, outputs, [], [], []);
                    lastCtlAt = nowMs;
                }
            }
        }
        return new Result(transport.Tlm / (double)Seconds, transport.LidarBytes / (double)Seconds,
            transport.Ctl / (double)Seconds, uplink / (double)Seconds, transport.Messages, fields);
    }

    /// <summary>
    /// Raw revolution. Sparse: a 60-cell wall (one field per cell) whose
    /// distance moves 3 cm per scan while driving (beyond the 2 cm deadband).
    /// Dense: every cell holds five 3-point groups, one per zone.
    /// </summary>
    private static int[] Scan(Lidar lidar, double t)
    {
        var d = LidarTestData.Points();
        if (lidar == Lidar.Sparse)
        {
            var mm = 1500 + (int)(t * 5 * 30) % 1000; // +30 mm per 5 Hz scan
            return LidarTestData.Run(0, 60 * 15, mm, d);
        }
        int[] zones = [400, 800, 1500, 2500, 4000];
        var shift = (int)(t * 5 * 30) % 90;
        for (var cell = 0; cell < Grid.Cells; cell++)
        {
            for (var z = 0; z < 5; z++) LidarTestData.Run(cell * 15 + z * 3, 3, zones[z] - shift * (z + 1) / 5, d);
        }
        return d;
    }

    private static readonly JsonHubProtocol Json = new(Options.Create(new JsonHubProtocolOptions()));

    /// <summary>Serialized size incl. record separator plus the websocket frame header (server → client unmasked).</summary>
    private static int Frame(IHubProtocol protocol, HubMessage message)
    {
        var buffer = new ArrayBufferWriter<byte>();
        protocol.WriteMessage(message, buffer);
        var n = buffer.WrittenCount;
        return n + (n < 126 ? 2 : n < 65536 ? 4 : 10);
    }

    private sealed class ChannelNames(IReadOnlyDictionary<int, string> names) : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) => Task.FromResult(names);
    }

    private sealed class Capture : ITelemetryTransport, IControlDisplayTransport
    {
        public readonly List<(string Onboard, int[] Ids)> Demands = [];
        public readonly List<bool> CtlDemand = [];
        public long Tlm, Ctl, LidarBytes;
        public int Messages;

        public void ResetCounters()
        {
            lock (this) { Tlm = Ctl = LidarBytes = 0; Messages = 0; }
        }

        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged)
        {
            var size = Frame(Json, new InvocationMessage("Tlm", [carId, seq, ageMs, changed, touched, touchedAged]));
            // Share of the LiDAR entries: the grid value text dominates; count its entry as serialized alone.
            var lidar = changed.Where(c => (int)c[0] == LidarId).Sum(c => System.Text.Json.JsonSerializer.Serialize(c).Length + 1);
            lock (this) { Tlm += size; LidarBytes += lidar; Messages++; }
            return Task.CompletedTask;
        }

        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;

        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds)
        {
            lock (this) Demands.Add((onboardConnectionId, channelIds));
            return Task.CompletedTask;
        }

        public Task SendAsync(string connectionId, int carId, string driverEpoch, long seq, bool paused, int ageMs,
            object[][] outputs, object[][] signals, int[] removedOutputs, string[] removedSignals)
        {
            var size = Frame(Json, new InvocationMessage("Ctl", [carId, driverEpoch, seq, paused, ageMs, outputs, signals, removedOutputs, removedSignals]));
            lock (this) { Ctl += size; Messages++; }
            return Task.CompletedTask;
        }

        public Task SendClearedAsync(string connectionId, int carId, string driverEpoch) => Task.CompletedTask;

        public Task SendDemandAsync(string driverConnectionId, int carId, bool needed)
        {
            lock (this) CtlDemand.Add(needed);
            return Task.CompletedTask;
        }
    }
}
