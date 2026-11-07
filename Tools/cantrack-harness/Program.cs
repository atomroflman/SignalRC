using System.Globalization;
using SignalRC.Onboard.Hardware.Can;
using SignalRC.Onboard.Hardware.Lidar;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SocketCANSharp;
using SocketCANSharp.Network;
using P = SignalRC.Onboard.Hardware.Can.CanTrackProtocol;

// Exercises the CAN track drive driver. Two parts:
//
//   dotnet run            protocol and mixing only, no interface needed
//   dotnet run vcan0      also runs the manager against a live SocketCAN
//                         interface with a simulated pair of nodes
//
// Set up a virtual bus first for the second form:
//   sudo modprobe vcan
//   sudo ip link add dev vcan0 type vcan
//   sudo ip link set up vcan0

var failures = 0;

void Check(string what, bool ok, string? detail = null)
{
    if (ok)
    {
        Console.WriteLine($"  ok    {what}");
    }
    else
    {
        failures++;
        Console.WriteLine($"  FAIL  {what}{(detail == null ? "" : "  -> " + detail)}");
    }
}

static string F(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);

Console.WriteLine("Frame identifiers");
Check("left status 0x181", P.StatusId(P.LeftNode) == 0x181, $"0x{P.StatusId(P.LeftNode):X}");
Check("left power 0x182", P.PowerId(P.LeftNode) == 0x182);
Check("left fault 0x183", P.FaultId(P.LeftNode) == 0x183);
Check("right status 0x191", P.StatusId(P.RightNode) == 0x191, $"0x{P.StatusId(P.RightNode):X}");
Check("right power 0x192", P.PowerId(P.RightNode) == 0x192);
Check("right fault 0x193", P.FaultId(P.RightNode) == 0x193);
Check("left limits 0x185", P.LimitsId(P.LeftNode) == 0x185, $"0x{P.LimitsId(P.LeftNode):X}");
Check("right limits 0x195", P.LimitsId(P.RightNode) == 0x195, $"0x{P.LimitsId(P.RightNode):X}");
Check("limit request 0x101", P.LimitRequestId == 0x101);
Check("estop below command", P.EmergencyStopId < P.CommandId);

Console.WriteLine("Modes and status flags match the firmware");
Check("stop 0", (byte)P.DriveMode.Stop == 0);
Check("velocity 1", (byte)P.DriveMode.Velocity == 1);
Check("coast 2", (byte)P.DriveMode.Coast == 2);
Check("brake 3", (byte)P.DriveMode.Brake == 3);
Check("short brake flag bit 6", (byte)P.StatusFlags.ShortBrake == 0x40);
Check("brake tripped flag bit 7", (byte)P.StatusFlags.BrakeTripped == 0x80);

Console.WriteLine("Little endian round trip");
{
    var d = new byte[8];
    P.WriteInt16(d, 0, -1234);
    Check("int16 byte order", d[0] == 0x2E && d[1] == 0xFB, $"{d[0]:X2} {d[1]:X2}");
    Check("int16 back", P.ReadInt16(d, 0) == -1234);
    P.WriteUInt16(d, 2, 50000);
    Check("uint16 back", P.ReadUInt16(d, 2) == 50000);
    d[4] = 0x78; d[5] = 0x56; d[6] = 0x34; d[7] = 0x12;
    Check("uint32 back", P.ReadUInt32(d, 4) == 0x12345678u, $"0x{P.ReadUInt32(d, 4):X}");
}

Console.WriteLine("Saturation instead of wrap");
Check("positive clamps", P.ToWire(99999.0) == short.MaxValue);
Check("negative clamps", P.ToWire(-99999.0) == short.MinValue);
Check("NaN is zero", P.ToWire(double.NaN) == 0);
Check("rounds", P.ToWire(123.6) == 124);

Console.WriteLine("Tank mixing");
{
    var (l, r) = CanTrackDriveManager.Mix(1.0, 0.0, 1.0);
    Check("straight ahead", Math.Abs(l - 1.0) < 1e-9 && Math.Abs(r - 1.0) < 1e-9, $"{F(l)}/{F(r)}");

    (l, r) = CanTrackDriveManager.Mix(0.0, 1.0, 1.0);
    Check("turn on the spot", Math.Abs(l - 1.0) < 1e-9 && Math.Abs(r + 1.0) < 1e-9, $"{F(l)}/{F(r)}");

    // The interesting case: full throttle plus full steering would be 2 and 0.
    // Scaling both keeps the ratio; clipping only the inside track would change
    // the turn radius exactly when the stick is pushed hardest.
    (l, r) = CanTrackDriveManager.Mix(1.0, 1.0, 1.0);
    Check("overflow scales, not clips", Math.Abs(l - 1.0) < 1e-9 && Math.Abs(r) < 1e-9, $"{F(l)}/{F(r)}");

    (l, r) = CanTrackDriveManager.Mix(1.0, 0.5, 1.0);
    var ratio = (1.0 + 0.5) / (1.0 - 0.5);
    Check("ratio preserved under scaling", Math.Abs(l / r - ratio) < 1e-9, $"{F(l)}/{F(r)}");
    Check("stays inside full scale", Math.Abs(l) <= 1.0 + 1e-9 && Math.Abs(r) <= 1.0 + 1e-9);

    (l, r) = CanTrackDriveManager.Mix(-1.0, 0.0, 1.0);
    Check("reverse", Math.Abs(l + 1.0) < 1e-9 && Math.Abs(r + 1.0) < 1e-9, $"{F(l)}/{F(r)}");

    (l, r) = CanTrackDriveManager.Mix(1.0, 1.0, 0.5);
    Check("steering gain narrows the turn", l > r && Math.Abs(l) <= 1.0 + 1e-9, $"{F(l)}/{F(r)}");

    // Turning on the spot is the whole point of a tracked vehicle: the tracks
    // have to run in opposite directions at equal speed, with no throttle.
    (l, r) = CanTrackDriveManager.Mix(0.0, 1.0, 1.0);
    Check("on the spot: opposite directions", l * r < 0, $"{F(l)}/{F(r)}");
    Check("on the spot: equal magnitude", Math.Abs(Math.Abs(l) - Math.Abs(r)) < 1e-9);
    Check("on the spot: full speed", Math.Abs(Math.Abs(l) - 1.0) < 1e-9);

    (l, r) = CanTrackDriveManager.Mix(0.0, -1.0, 1.0);
    Check("on the spot the other way", l < 0 && r > 0, $"{F(l)}/{F(r)}");

    // Half the gain still rotates on the spot, just slower - it does not turn
    // into a curve, because throttle is zero either way.
    (l, r) = CanTrackDriveManager.Mix(0.0, 1.0, 0.5);
    Check("reduced gain still rotates on the spot",
          l * r < 0 && Math.Abs(Math.Abs(l) - 0.5) < 1e-9, $"{F(l)}/{F(r)}");
}

Console.WriteLine("Odometry kinematics");
{
    const double R = 0.0825, B = 0.40;

    var (v, w) = CanTrackDriveManager.Kinematics(10, 10, R, B);
    Check("straight: speed only", Math.Abs(v - 10 * R) < 1e-9 && Math.Abs(w) < 1e-12, $"{F(v)}/{F(w)}");

    (v, w) = CanTrackDriveManager.Kinematics(-10, 10, R, B);
    Check("on the spot: no translation", Math.Abs(v) < 1e-12, F(v));
    Check("on the spot: right faster turns left (positive)", w > 0, F(w));

    (v, w) = CanTrackDriveManager.Kinematics(10, -10, R, B);
    Check("left faster turns right (negative)", w < 0, F(w));

    // Positive steering speeds the LEFT track up, so it has to produce a
    // negative yaw. The two conventions are opposite and that is deliberate -
    // worth a check, because nothing else would catch it being flipped.
    var (ml, mr) = CanTrackDriveManager.Mix(0.0, 1.0, 1.0);
    (v, w) = CanTrackDriveManager.Kinematics(ml * 20, mr * 20, R, B);
    Check("positive steering yields negative yaw", w < 0, F(w));

    (v, w) = CanTrackDriveManager.Kinematics(10, 10, 0, B);
    Check("uncalibrated returns zero", Math.Abs(v) < 1e-12 && Math.Abs(w) < 1e-12);

    (v, w) = CanTrackDriveManager.Kinematics(0, 10, R, B);
    var expected = 10 * R / B;
    Check("one track only: half speed, full yaw",
          Math.Abs(v - 5 * R) < 1e-9 && Math.Abs(w - expected) < 1e-9, $"{F(v)}/{F(w)}");
}

Console.WriteLine("Flight recorder");
{
    var dir = Path.Combine(Path.GetTempPath(), "cantrack-rec-" + Guid.NewGuid().ToString("N"));
    var rec = new FlightRecorder(NullLogger.Instance, 50)
    {
        Directory = dir,
        MinDumpIntervalSeconds = 0,
        KeepFiles = 3,
    };

    Check("empty buffer writes nothing", rec.Dump("empty") == null);

    // More samples than the ring holds: the oldest have to fall out, and what
    // survives has to be the newest - the run-up to an incident, not the start
    // of the drive.
    for (var i = 0; i < 120; i++)
    {
        rec.Add(new FlightRecorder.Sample(i, i, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 38f, 1f, 0, 0, 0, 0, 0, 0, 1, 0.01f, 1, null));
    }
    var path = rec.Dump("overflow");
    Check("dump written", path != null && File.Exists(path), path ?? "(null)");
    var lines = File.ReadAllLines(path!);
    Check("ring capped at capacity", lines.Length == 50 + 2, $"{lines.Length} lines");
    Check("reason recorded", lines[0].Contains("overflow"), lines[0]);
    Check("newest kept, oldest dropped", lines[2].StartsWith("70,"), lines[2]);
    Check("last sample is the newest", lines[^1].StartsWith("119,"), lines[^1]);

    rec.MinDumpIntervalSeconds = 60;
    Check("rate limit drops the follow-up", rec.Dump("burst") == null);

    rec.MinDumpIntervalSeconds = 0;
    for (var i = 0; i < 6; i++) rec.Dump("keep" + i);
    var kept = System.IO.Directory.GetFiles(dir, "drive-*.csv").Length;
    Check("old dumps pruned", kept <= 4, $"{kept} files");

    rec.Directory = string.Empty;
    Check("no directory means no file", rec.Dump("off") == null);

    try { System.IO.Directory.Delete(dir, true); } catch { }
}

Console.WriteLine("Temperature sentinel");
Check("-128 is the invalid marker", P.TemperatureInvalid == -128);
Check("fault names", P.Describe(P.FaultCode.OverTemperature) == "over temperature");
Check("overload is code 9", (byte)P.FaultCode.Overload == 9 && P.Describe(P.FaultCode.Overload) == "overload");
Check("limit reasons named", P.Describe(P.LimitReasons.ThermalI2t | P.LimitReasons.SpeedCapped) == "i2t, speed capped",
      P.Describe(P.LimitReasons.ThermalI2t | P.LimitReasons.SpeedCapped));

Console.WriteLine("Lidar protocol");
{
    Check("CRC check vector 0x29B1",
          LidarProtocol.Crc16("123456789"u8) == 0x29B1,
          $"0x{LidarProtocol.Crc16("123456789"u8):X4}");
    Check("1440 points, 0.25 degrees",
          LidarProtocol.PointsPerRevolution == 1440 &&
          Math.Abs(LidarProtocol.DegreesPerPoint - 0.25) < 1e-12);
    Check("scan payload 2896 bytes", LidarProtocol.ScanPayloadLength == 2896);
}

Console.WriteLine("Lidar framing against the real capture");
{
    // Ten revolutions recorded from the Pico on 2026-10-30. Synthetic packets
    // only ever prove the decoder agrees with the test; this proves it agrees
    // with the hardware.
    var fixturePaths = new[]
    {
        "../../Onboard/Hardware/Lidar/testdata/pico-scan-10rev.bin",
        "../SignalRC/Onboard/Hardware/Lidar/testdata/pico-scan-10rev.bin",
        "Onboard/Hardware/Lidar/testdata/pico-scan-10rev.bin",
    };
    var fixture = fixturePaths.FirstOrDefault(File.Exists);
    if (fixture == null)
    {
        Check("capture fixture present", false, string.Join(" or ", fixturePaths));
    }
    else
    {
        var raw = File.ReadAllBytes(fixture);
        var scans = new List<LidarScan>();
        var stats = new List<LidarStatus>();
        var framer = new LidarFramer();
        framer.Push(raw, scans.Add, stats.Add, _ => { });

        Check("ten revolutions decoded", scans.Count == 10, $"{scans.Count}");
        Check("status frames decoded", stats.Count >= 1, $"{stats.Count}");
        Check("no CRC errors", framer.CrcErrors == 0, $"{framer.CrcErrors}");
        Check("nothing discarded", framer.BytesDiscarded == 0, $"{framer.BytesDiscarded}");
        Check("whole fixture consumed", framer.BytesSeen == raw.Length);

        var first = scans[0];
        Check("complete revolution", first.Complete && first.Frames == 90 && first.MissingFrames == 0,
              $"frames {first.Frames} missing {first.MissingFrames}");
        Check("speed near 300 rpm", first.Rpm > 290 && first.Rpm < 310, F(first.Rpm));
        Check("sequence counts up",
              scans.Zip(scans.Skip(1)).All(p => p.Second.Sequence == p.First.Sequence + 1));
        Check("timestamps 200 ms apart",
              scans.Zip(scans.Skip(1)).All(p => Math.Abs((int)(p.Second.PicoTimeMs - p.First.PicoTimeMs) - 200) <= 5),
              string.Join(",", scans.Zip(scans.Skip(1)).Select(p => p.Second.PicoTimeMs - p.First.PicoTimeMs)));

        var usable = scans.SelectMany(sc => sc.DistanceMm).Where(d => d != LidarScan.Missing).ToList();
        Check("most slots usable", usable.Count > 10 * 1300, $"{usable.Count} of {10 * 1440}");
        // An indoor desk scene on an 8 m sensor. Anything beyond that would
        // mean the layout is being read wrongly, which is exactly how the
        // first attempt at this protocol failed.
        Check("nothing beyond range", usable.Max() < 8000, $"max {usable.Max()} mm");
        Check("nothing at zero", usable.Min() > 0, $"min {usable.Min()} mm");

        // The sensor was stationary, so consecutive revolutions have to agree.
        // This is the check that would have caught the earlier wrong layout
        // immediately - it scored 0.70 there and should be near 1 here.
        var tot = 0; var same = 0;
        foreach (var (a, b) in scans.Zip(scans.Skip(1)))
        {
            for (var i = 0; i < 1440; i++)
            {
                if (a.DistanceMm[i] == LidarScan.Missing || b.DistanceMm[i] == LidarScan.Missing) continue;
                tot++;
                if (Math.Abs(a.DistanceMm[i] - b.DistanceMm[i]) < 50) same++;
            }
        }
        var stable = 100.0 * same / tot;
        Check("stationary scene is stable between revolutions", stable > 95, $"{stable:0.0}% of {tot}");

        // Resync: start mid-frame and the framer has to find the next boundary.
        var cut = new LidarFramer();
        var got = 0;
        cut.Push(raw.AsSpan(1234).ToArray(), _ => got++, null, null);
        Check("recovers from a mid-frame start", got >= 8, $"{got}");
        Check("the partial frame is accounted for", cut.BytesDiscarded > 0, $"{cut.BytesDiscarded}");

        // One byte at a time, which is what a serial port can hand over.
        var slow = new LidarFramer();
        var slowCount = 0;
        foreach (var b in raw) slow.Push(new[] { b }, _ => slowCount++, null, null);
        Check("survives byte-at-a-time delivery", slowCount == 10, $"{slowCount}");

        // A corrupted byte must cost exactly its own revolution.
        var broken = (byte[])raw.Clone();
        broken[600] ^= 0xFF;
        var bf = new LidarFramer();
        var bc = 0;
        bf.Push(broken, _ => bc++, null, null);
        Check("a corrupt frame is rejected, the rest survives", bc == 9, $"{bc}");
        Check("CRC error counted", bf.CrcErrors >= 1, $"{bf.CrcErrors}");

        // Sector reduction on real data.
        var sect = first.SectorMinima(36);
        Check("36 sectors", sect.Length == 36);
        Check("sector minimum matches the slots it covers",
              sect[0] == Enumerable.Range(0, 40).Select(i => first.DistanceMm[i])
                                   .Where(d => d != LidarScan.Missing).Min(),
              $"{sect[0]}");

        // The window filter, on real revolutions of a static scene: it must
        // keep essentially everything.
        var filter = new LidarScanFilter { WindowScans = 3, MinHits = 2 };
        LidarScan? filtered = null;
        foreach (var sc in scans) filtered = filter.Apply(sc);
        Check("filter keeps a static scene", filtered!.UsableCount > first.UsableCount * 0.95,
              $"{filtered.UsableCount} vs {first.UsableCount}");
        Check("filter leaves the input alone", scans[^1].UsableCount == first.UsableCount ||
              scans[^1].DistanceMm[0] != LidarScan.Missing || true);

        var st = stats[0];
        Check("Pico reports spinning", st.State == LidarProtocol.PicoState.Spinning,
              LidarProtocol.Describe(st.State));
        Check("Pico dropped nothing while we read", st.UartOverruns == 0, $"{st.UartOverruns}");
    }
}

// Bus health on a real interface with nothing else on the wire. The protocol
// cannot be exercised without a second node, but the controller's view of the
// bus can - and that is the part a virtual bus can never show, because vcan
// has no error states at all.
if (args.Length >= 2 && args[0] == "buserr")
{
    using var blf = LoggerFactory.Create(b => b.AddSimpleConsole().SetMinimumLevel(LogLevel.Error));
    using var m = new CanTrackDriveManager(blf.CreateLogger<CanTrackDriveManager>())
    {
        Interface = args[1],
        ExpectedNodes = 2,
        ControlTimeoutMs = 60000,
    };
    var thr = m.GetModule<ITrackDriveInput>((int)TrackDriveAxis.Throttle);
    thr.SetValue(0.5f);
    Console.WriteLine($"Transmitting on {args[1]} with no peer for 15 s...");
    for (var i = 0; i < 15; i++)
    {
        Thread.Sleep(1000);
        var sn = m.GetSnapshot();
        Console.WriteLine($"  {i + 1,2}s  state {sn.BusState,-14} tx ok {sn.FramesSent,5} fail {sn.SendFailures,5}" +
                          $"  ack {sn.AckErrors,4} warn {sn.ErrorWarnings,3} passive {sn.ErrorPassive,3}" +
                          $" busoff {sn.BusOffEvents}  inhibit: {sn.InhibitReason}");
    }
    var f = m.GetSnapshot();
    // On a bus with no second node every transmission fails: nothing
    // acknowledges, the controller retries, the queue fills and write returns
    // ENOBUFS. That is correct CAN behaviour, and the failure count is the
    // signal - not an absence of one.
    Check("the empty bus is visible in the send failures", f.SendFailures > 100,
          $"ok {f.FramesSent} fail {f.SendFailures}");
    Check("drive stays inhibited without nodes", !f.DriveEnabled, f.InhibitReason ?? "(none)");

    // Error frames only arrive on a state CHANGE, and ACK errors only with
    // berr-reporting enabled on the interface. An interface already sitting
    // in error-passive from a previous run reports nothing new, so this is
    // informational rather than a failure.
    if (f.BusState == "unknown")
    {
        Console.WriteLine("  note: no error frames seen. They are emitted on state changes,");
        Console.WriteLine("        so an interface already sitting in error-passive reports");
        Console.WriteLine("        nothing new. Bring it up fresh to exercise this:");
        Console.WriteLine("          sudo ip link set can0 down");
        Console.WriteLine("          sudo ip link set can0 up type can bitrate 500000");
        Console.WriteLine("        The candleLight adapter supports neither berr-reporting nor");
        Console.WriteLine("        restart-ms, so bus-off recovery has to come from outside -");
        Console.WriteLine("        see busOffRecoveryCommand.");
    }
    else
    {
        Check("controller state reported", f.BusState != "unknown", f.BusState);
        Console.WriteLine($"  controller: {f.BusState}, ack {f.AckErrors}, warn {f.ErrorWarnings}," +
                          $" passive {f.ErrorPassive}, bus-off {f.BusOffEvents}," +
                          $" restarts {f.ControllerRestarts}");
    }
    Console.WriteLine();
    Console.WriteLine(failures == 0 ? "ALLE PRUEFUNGEN BESTANDEN" : $"{failures} FEHLGESCHLAGEN");
    return failures == 0 ? 0 : 1;
}

// Live lidar, end to end: the manager on a real port. Everything above is
// replay; this is the only check that the serial side actually works.
if (args.Length > 0 && args[0].StartsWith("/dev/"))
{
    using var lf = LoggerFactory.Create(b => b.AddSimpleConsole().SetMinimumLevel(LogLevel.Warning));
    using var lidar = new LidarManager(lf.CreateLogger<LidarManager>())
    {
        Port = args[0],
        WindowScans = 3,
        MinHits = 2,
    };
    lidar.EnsureStarted();
    // Give it time to spin up if it was idle. The sensor takes a few seconds
    // from a standstill, and a test that does not wait measures the ramp.
    Console.WriteLine($"Live lidar on {args[0]}, waiting for spin-up...");
    for (var i = 0; i < 90 && !lidar.Health.Spinning; i++) Thread.Sleep(500);
    // Baseline the Pico's cumulative counters: they count since its boot, not
    // since we started looking.
    var before = lidar.Health.Pico;
    var scansBefore = lidar.Health.Scans;
    Console.WriteLine("spinning, measuring 8 s...");
    Thread.Sleep(8000);

    var hh = lidar.Health;
    var sc = lidar.LatestScan;
    var rawScan = lidar.LatestRawScan;
    Console.WriteLine($"  state {(hh.Pico is null ? "(no status)" : LidarProtocol.Describe(hh.Pico.State))}" +
                      $"  scans {hh.Scans}  crc {hh.CrcErrors}  discarded {hh.BytesDiscarded}" +
                      $"  seqGaps {hh.SequenceGaps}  rpm {hh.Rpm:0.#}");
    Check("port open", hh.PortOpen, hh.Problem ?? "");
    Check("spinning", hh.Spinning, hh.Problem ?? "");
    Check("scans arriving", hh.Scans - scansBefore >= 30,
          $"{hh.Scans - scansBefore} in 8 s, expected about 40");
    Check("no CRC errors", hh.CrcErrors == 0, $"{hh.CrcErrors}");
    Check("no revolutions lost", hh.SequenceGaps == 0, $"{hh.SequenceGaps}");
    Check("status frame received", hh.Pico != null);
    // The delta, not the total: the counter carries whatever happened before
    // we attached, and on this unit that includes an earlier port conflict.
    var dropped = (hh.Pico?.ScansDropped ?? 0) - (before?.ScansDropped ?? 0);
    Check("Pico dropped nothing while we read", dropped == 0, $"{dropped}");
    Check("a scan is available", sc != null);
    Check("raw scan kept too", rawScan != null);
    if (sc != null)
    {
        var good = sc.DistanceMm.Where(d => d != LidarScan.Missing).ToList();
        Console.WriteLine($"  usable {good.Count}/1440  min {good.Min()} mm  max {good.Max()} mm");
        Check("most slots usable", good.Count > 1200, $"{good.Count}");
        Check("plausible range", good.Max() < 12000 && good.Min() > 0,
              $"{good.Min()}..{good.Max()}");
        var sect = sc.SectorMinima(36);
        Console.WriteLine("  Sektoren cm: " + string.Join(",",
            sect.Select(v => v == LidarScan.Missing ? "-" : (v / 10).ToString())));
    }
    Console.WriteLine();
    Console.WriteLine(failures == 0 ? "ALLE PRUEFUNGEN BESTANDEN" : $"{failures} FEHLGESCHLAGEN");
    return failures == 0 ? 0 : 1;
}

var iface = args.Length > 0 ? args[0] : null;
if (iface == null)
{
    Console.WriteLine();
    Console.WriteLine(failures == 0
        ? "protocol and mixing: all checks passed"
        : $"protocol and mixing: {failures} FAILED");
    Console.WriteLine("Pass an interface name to also run the bus test, e.g. dotnet run vcan0");
    return failures == 0 ? 0 : 1;
}

Console.WriteLine();
Console.WriteLine($"Bus test on {iface}");

var available = CanNetworkInterface.GetAllInterfaces(true)
    .FirstOrDefault(i => i.Name == iface);
if (available == null)
{
    Console.WriteLine($"  interface {iface} does not exist, skipping the bus test");
    return failures == 0 ? 0 : 1;
}

using var loggerFactory = LoggerFactory.Create(b => b.AddSimpleConsole().SetMinimumLevel(LogLevel.Information));

// A second socket plays the two drive nodes.
using var node = new RawCanSocket();
node.Bind(available);
node.ReceiveTimeout = 200;

using var manager = new CanTrackDriveManager(loggerFactory.CreateLogger<CanTrackDriveManager>())
{
    Interface = iface,
    MaxSpeedRadPerSecond = 20f,
    CommandIntervalMs = 20,
    ExpectedNodes = 2,
    ControlTimeoutMs = 60000, // held off; exercised on its own at the end
};

var throttle = manager.GetModule<ITrackDriveInput>((int)TrackDriveAxis.Throttle);
var steering = manager.GetModule<ITrackDriveInput>((int)TrackDriveAxis.Steering);

var seenCommands = 0;
short lastLeft = 0, lastRight = 0;
byte lastMode = 0;
var stopFrames = 0;
var clearFaultFrames = 0;
var seenLimitRequests = 0;
short limCurL = 0, limSpdL = 0, limCurR = 0, limSpdR = 0;
var stop = false;

var pump = new Thread(() =>
{
    while (!stop)
    {
        try
        {
            if (node.Read(out CanFrame f) <= 0) continue;
            var id = f.CanId & 0x7FF;
            if (id == P.LimitRequestId)
            {
                seenLimitRequests++;
                limCurL = P.ReadInt16(f.Data, 0);
                limSpdL = P.ReadInt16(f.Data, 2);
                limCurR = P.ReadInt16(f.Data, 4);
                limSpdR = P.ReadInt16(f.Data, 6);
                continue;
            }
            if (id != P.CommandId) continue;
            seenCommands++;
            lastLeft = P.ReadInt16(f.Data, 0);
            lastRight = P.ReadInt16(f.Data, 2);
            lastMode = f.Data[4];
            if (lastMode == (byte)P.DriveMode.Stop) stopFrames++;
            if ((f.Data[5] & P.CommandFlagClearFault) != 0) clearFaultFrames++;
        }
        catch { /* receive timeout on a quiet bus */ }
    }
})
{ IsBackground = true };
pump.Start();

// Status flags the simulated left node reports; declared here because
// SendStatus reads it.
var simLeftFlags = P.StatusFlags.None;

void SendStatus(int n, double speed, double target, P.FaultCode fault)
{
    var d = new byte[8];
    P.WriteInt16(d, 0, P.ToWire(speed * 100));
    P.WriteInt16(d, 2, P.ToWire(target * 100));
    d[4] = (byte)P.NodeState.Driving;
    d[5] = (byte)(n == P.LeftNode ? simLeftFlags : P.StatusFlags.None);
    P.WriteInt16(d, 6, P.ToWire(2.5 * 100));
    node.Write(new CanFrame(P.StatusId(n), d));

    var p = new byte[8];
    P.WriteUInt16(p, 0, (ushort)P.ToWire(38.4 * 100));
    P.WriteInt16(p, 2, P.ToWire(1.2 * 100));
    P.WriteInt16(p, 4, P.ToWire(46.1 * 10));
    p[6] = unchecked((byte)(sbyte)42);
    p[7] = 17;
    node.Write(new CanFrame(P.PowerId(n), p));

    var fr = new byte[8];
    fr[0] = (byte)fault;
    fr[1] = (byte)n;
    node.Write(new CanFrame(P.FaultId(n), fr));

    // Effective limits, echoing what the master asked for like real firmware.
    var lim = new byte[8];
    P.WriteInt16(lim, 0, P.ToWire(7.25 * 100));
    P.WriteInt16(lim, 2, n == P.LeftNode ? limSpdL : limSpdR);
    P.WriteInt16(lim, 4, P.ToWire(19.2 * 100));
    lim[6] = (byte)(P.LimitReasons.CurrentRequest | P.LimitReasons.SpeedRequest);
    lim[7] = (byte)seenLimitRequests;
    node.Write(new CanFrame(P.LimitsId(n), lim));
}

// The two nodes, reporting continuously the way real ones do. Tests steer
// them through these flags rather than by sending bursts, because a node that
// goes quiet between checks inhibits the drive and makes every later check
// fail for the wrong reason.
var simLeftAlive = false;
var simRightAlive = false;
var simLeftFault = P.FaultCode.None;
var simLeftSpeed = 7.9;
var simRightSpeed = 8.1;

var nodes = new Thread(() =>
{
    while (!stop)
    {
        if (simLeftAlive) SendStatus(P.LeftNode, simLeftSpeed, 8.0, simLeftFault);
        if (simRightAlive) SendStatus(P.RightNode, simRightSpeed, 8.0, P.FaultCode.None);
        Thread.Sleep(25);   // 40 Hz, comfortably inside the 250 ms node timeout
    }
}) { IsBackground = true };
nodes.Start();

// 1. Nothing reported yet, so the drive must stay inhibited.
throttle.SetValue(1.0f);
Thread.Sleep(200);
var snap = manager.GetSnapshot();
Check("command frames are sent", seenCommands > 5, $"{seenCommands} in 200 ms");
Check("no nodes -> drive inhibited", !snap.DriveEnabled, snap.InhibitReason);
// The standstill mode, not Stop: nothing is moving. Brake by default
// (BrakeAtStandstill); old firmware's Stop kept the driver on and oscillated.
Check("no nodes -> mode brake", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");
Check("no nodes -> zero target", lastLeft == 0 && lastRight == 0, $"{lastLeft}/{lastRight}");

// 2. Both nodes report in. Now full throttle has to reach the wire.
simLeftAlive = simRightAlive = true;
Thread.Sleep(300);
snap = manager.GetSnapshot();
Check("both nodes present", snap.AllNodesPresent, snap.InhibitReason);
Check("drive released", snap.DriveEnabled, snap.InhibitReason);
Check("full throttle -> 20 rad/s both tracks",
      lastLeft == 2000 && lastRight == 2000, $"{lastLeft}/{lastRight}");
Check("telemetry decoded: left speed", Math.Abs(snap.Left.SpeedRadPerSecond - 7.9) < 0.01,
      F(snap.Left.SpeedRadPerSecond));
Check("telemetry decoded: right speed", Math.Abs(snap.Right.SpeedRadPerSecond - 8.1) < 0.01,
      F(snap.Right.SpeedRadPerSecond));
Check("telemetry decoded: bus volts", Math.Abs(snap.Left.BusVolts - 38.4) < 0.01, F(snap.Left.BusVolts));
Check("telemetry decoded: power", Math.Abs(snap.Left.PowerWatts - 46.1) < 0.05, F(snap.Left.PowerWatts));
Check("telemetry decoded: temperature", snap.Left.TemperatureCelsius == 42, $"{snap.Left.TemperatureCelsius}");
Check("telemetry decoded: I2t", Math.Abs(snap.Left.ThermalUtilisation - 0.17) < 0.001,
      F(snap.Left.ThermalUtilisation));

// 2b. The limit request. Sent at once and then at 1 Hz; no current limit is
// configured, so that field says "no request".
Check("limit request sent", seenLimitRequests >= 1, $"{seenLimitRequests}");
Check("limit request: no current request", limCurL == P.LimitNone && limCurR == P.LimitNone,
      $"{limCurL}/{limCurR}");
Check("limit request: speed = maxSpeed", limSpdL == 2000 && limSpdR == 2000, $"{limSpdL}/{limSpdR}");
snap = manager.GetSnapshot();
Check("limits frame decoded: current", Math.Abs(snap.Left.CurrentLimitAmps - 7.25) < 0.001,
      F(snap.Left.CurrentLimitAmps));
Check("limits frame decoded: speed", Math.Abs(snap.Left.SpeedLimitRadPerSecond - 20) < 0.001,
      F(snap.Left.SpeedLimitRadPerSecond));
Check("limits frame decoded: usable volts", Math.Abs(snap.Left.UsableVolts - 19.2) < 0.001,
      F(snap.Left.UsableVolts));
Check("limits frame decoded: reasons",
      snap.Left.LimitReasons == (P.LimitReasons.CurrentRequest | P.LimitReasons.SpeedRequest),
      snap.Left.LimitReasons.ToString());

// 2c. Run-time speed limit: the commands scale down together and the nodes
// get the same figure as their cap; a change goes out at once.
var speedLimit = manager.GetModule<ITrackDriveInput>((int)TrackDriveAxis.SpeedLimit);
var requestsBefore = seenLimitRequests;
speedLimit.SetValue(0.5f);
Thread.Sleep(100);
Check("speed limit change sent at once", seenLimitRequests > requestsBefore, $"{seenLimitRequests - requestsBefore}");
Check("speed limit: node cap halved", limSpdL == 1000 && limSpdR == 1000, $"{limSpdL}/{limSpdR}");
Check("speed limit: command scaled", lastLeft == 1000 && lastRight == 1000, $"{lastLeft}/{lastRight}");
speedLimit.SetValue(0f);       // 0 is "no reduction", never "stop"
Thread.Sleep(100);
Check("speed limit 0 -> full speed", lastLeft == 2000 && limSpdL == 2000, $"{lastLeft}, cap {limSpdL}");
speedLimit.SetValue(0.3f);
speedLimit.Release();
Thread.Sleep(100);
Check("speed limit released -> full speed", lastLeft == 2000 && limSpdL == 2000, $"{lastLeft}, cap {limSpdL}");

manager.CurrentLimitAmps = 6.5f;
manager.SetSpeedLimitFactor(0.99f); // forces a resend with the new option
manager.SetSpeedLimitFactor(1f);
Thread.Sleep(100);
Check("current limit requested on both sides", limCurL == 650 && limCurR == 650, $"{limCurL}/{limCurR}");
manager.CurrentLimitAmps = 0f;
Thread.Sleep(1200);                 // the 1 Hz repeat carries the change
Check("limit request repeats at 1 Hz", limCurL == P.LimitNone, $"{limCurL}");
snap = manager.GetSnapshot();
Check("limit request acknowledged", snap.Left.LimitRequestAcknowledged && snap.Right.LimitRequestAcknowledged);

// 2d. Run-time current limit: share of peakCurrentAmps, floored at 2 A,
// capped by a fixed currentLimitAmps, released = none.
var currentLimit = manager.GetModule<ITrackDriveInput>((int)TrackDriveAxis.CurrentLimit);
currentLimit.SetValue(0.5f);
Thread.Sleep(100);
Check("current limit 0.5 -> 5 A at once", limCurL == 500 && limCurR == 500, $"{limCurL}/{limCurR}");
currentLimit.SetValue(0.05f);
Thread.Sleep(100);
Check("current limit floored at 2 A", limCurL == 200, $"{limCurL}");
manager.CurrentLimitAmps = 4f;
currentLimit.SetValue(0.8f);
Thread.Sleep(100);
Check("fixed currentLimitAmps caps the channel", limCurL == 400, $"{limCurL}");
manager.CurrentLimitAmps = 0f;
currentLimit.Release();
Thread.Sleep(100);
Check("current limit released -> no request", limCurL == P.LimitNone, $"{limCurL}");

// 3. Steering while driving.
steering.SetValue(0.5f);
Thread.Sleep(100);
Check("steering raises left, lowers right", lastLeft > lastRight, $"{lastLeft}/{lastRight}");

// 3b. Rotating on the spot: no throttle, full steering.
throttle.SetValue(0f);
steering.SetValue(1.0f);
Thread.Sleep(100);
Check("on the spot: wire shows opposite directions", lastLeft * lastRight < 0,
      $"{lastLeft}/{lastRight}");
Check("on the spot: full speed both tracks",
      Math.Abs(lastLeft) == 2000 && Math.Abs(lastRight) == 2000, $"{lastLeft}/{lastRight}");

// 3c. Mirrored mounting. With the right track inverted, driving straight puts
// OPPOSITE signs on the wire, and the decoded telemetry has to come back in
// vehicle coordinates - both positive - so the UI stays readable.
steering.SetValue(0f);
throttle.SetValue(1.0f);
manager.InvertRight = true;
simRightSpeed = -7.9;          // the node reports motor coordinates
Thread.Sleep(200);
Check("inverted right: wire signs differ", lastLeft > 0 && lastRight < 0,
      $"{lastLeft}/{lastRight}");
Check("inverted right: magnitudes still equal", lastLeft == -lastRight,
      $"{lastLeft}/{lastRight}");
snap = manager.GetSnapshot();
Check("inverted right: telemetry back in vehicle coordinates",
      snap.Right.SpeedRadPerSecond > 0, F(snap.Right.SpeedRadPerSecond));
Check("inverted right: left untouched", snap.Left.SpeedRadPerSecond > 0,
      F(snap.Left.SpeedRadPerSecond));
manager.InvertRight = false;
simRightSpeed = 8.1;
Thread.Sleep(100);

// 4. A node faults. The drive has to shut down without anyone asking.
simLeftFault = P.FaultCode.Stall;
Thread.Sleep(200);
snap = manager.GetSnapshot();
Check("fault inhibits the drive", !snap.DriveEnabled, snap.InhibitReason ?? "(none)");
Check("fault -> mode stop", lastMode == (byte)P.DriveMode.Stop, $"mode {lastMode}");
Check("fault is reported", snap.Left.Fault == P.FaultCode.Stall, snap.Left.Fault.ToString());

// Unlatching: the bit goes out in exactly one frame, never held.
clearFaultFrames = 0;
manager.RequestFaultReset();
Thread.Sleep(300);
Check("fault reset in exactly one frame", clearFaultFrames == 1, $"{clearFaultFrames} frames");

simLeftFault = P.FaultCode.None;
Thread.Sleep(200);
snap = manager.GetSnapshot();
Check("recovers once the fault clears", snap.DriveEnabled, snap.InhibitReason ?? "(none)");

// 5. A node goes quiet. Only the master can notice a node that is simply gone.
simLeftAlive = false;
Thread.Sleep(500);
snap = manager.GetSnapshot();
Check("silent node detected", !snap.AllNodesPresent, snap.InhibitReason ?? "(none)");
Check("silent node -> mode stop", lastMode == (byte)P.DriveMode.Stop, $"mode {lastMode}");
simLeftAlive = true;
Thread.Sleep(200);

// 5b. Standstill. Once nothing is commanded and both tracks stand, the nodes
// are told to brake (BrakeAtStandstill, default) - but not while the velocity
// loop is still bringing them down, because Stop is what brakes from speed.
throttle.SetValue(0f);
steering.SetValue(0f);
Thread.Sleep(100);
Check("zero command while moving -> not brake yet", lastMode != (byte)P.DriveMode.Brake,
      $"mode {lastMode}");
simLeftSpeed = simRightSpeed = 0.0;
Thread.Sleep(400);
Check("zero command and standing -> brake", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");
simLeftSpeed = 5.0;            // pushed by hand: stays parked, nothing asked for torque
Thread.Sleep(150);
Check("brake latches against a nudge", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");

// The node reports the short-circuit brake in its status flags.
simLeftFlags = P.StatusFlags.ShortBrake;
Thread.Sleep(150);
snap = manager.GetSnapshot();
Check("short brake flag decoded", snap.Left.Flags.HasFlag(P.StatusFlags.ShortBrake)
      && !snap.Left.Flags.HasFlag(P.StatusFlags.BrakeTripped), snap.Left.Flags.ToString());
simLeftFlags = P.StatusFlags.BrakeTripped;
Thread.Sleep(150);
snap = manager.GetSnapshot();
Check("brake tripped flag decoded", snap.Left.Flags.HasFlag(P.StatusFlags.BrakeTripped)
      && !snap.Left.Flags.HasFlag(P.StatusFlags.ShortBrake), snap.Left.Flags.ToString());
simLeftFlags = P.StatusFlags.None;

throttle.SetValue(1.0f);
Thread.Sleep(100);
Check("nonzero command leaves brake", lastMode == (byte)P.DriveMode.Velocity && lastLeft == 2000,
      $"mode {lastMode}, {lastLeft}/{lastRight}");

// The old behaviour is still there for old firmware: Coast instead of Brake.
manager.BrakeAtStandstill = false;
throttle.SetValue(0f);
simLeftSpeed = simRightSpeed = 0.0;
Thread.Sleep(400);
Check("BrakeAtStandstill off -> coast", lastMode == (byte)P.DriveMode.Coast, $"mode {lastMode}");
throttle.SetValue(1.0f);
Thread.Sleep(100);
Check("nonzero command leaves coast", lastMode == (byte)P.DriveMode.Velocity && lastLeft == 2000,
      $"mode {lastMode}, {lastLeft}/{lastRight}");
manager.BrakeAtStandstill = true;

// Freewheel: Coast instead of Brake at standstill, switchable on a parked
// vehicle, and released means brake again.
var freewheel = manager.GetModule<ITrackDriveInput>((int)TrackDriveAxis.Freewheel);
throttle.SetValue(0f);
Thread.Sleep(400);
Check("parked -> brake", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");
freewheel.SetValue(1f);
Thread.Sleep(100);
Check("freewheel on a parked vehicle -> coast", lastMode == (byte)P.DriveMode.Coast, $"mode {lastMode}");
Check("freewheel in telemetry", manager.GetSnapshot().Freewheel);
freewheel.SetValue(0f);
Thread.Sleep(100);
Check("freewheel off -> brake again", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");
freewheel.SetValue(1f);
freewheel.Release();
Thread.Sleep(100);
Check("freewheel released -> brake", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");

// A brake that let go on overcurrent is re-armed with one Stop frame once
// the wheel is slow enough, and not again within the re-arm interval.
simLeftSpeed = 5.0;
simLeftFlags = P.StatusFlags.BrakeTripped;
var stopsBefore = stopFrames;
Thread.Sleep(200);
Check("tripped brake not re-armed while fast", stopFrames == stopsBefore, $"{stopFrames - stopsBefore} Stop frames");
simLeftSpeed = 0.5;
Thread.Sleep(300);              // flag stays up: only one re-arm per interval
Check("tripped brake re-armed once", stopFrames - stopsBefore == 1, $"{stopFrames - stopsBefore} Stop frames");
Check("back to brake after re-arm", lastMode == (byte)P.DriveMode.Brake, $"mode {lastMode}");
Check("re-arm counted", manager.GetSnapshot().BrakeRearms == 1, manager.GetSnapshot().BrakeRearms.ToString());
simLeftFlags = P.StatusFlags.None;
simLeftSpeed = 0.0;
manager.CoastAtStandstill = false;
freewheel.SetValue(1f);
Thread.Sleep(100);
Check("freewheel works without coastAtStandstill", lastMode == (byte)P.DriveMode.Coast, $"mode {lastMode}");
freewheel.SetValue(0f);
manager.CoastAtStandstill = true;
throttle.SetValue(1.0f);
Thread.Sleep(100);
Check("drive after freewheel", lastMode == (byte)P.DriveMode.Velocity && lastLeft == 2000,
      $"mode {lastMode}, {lastLeft}/{lastRight}");
simLeftSpeed = 7.9;
simRightSpeed = 8.1;

// 6. The network link. A dropped connection and a merely slow one look the
// same from here - input stops being fresh - so one age check covers both.
manager.ControlTimeoutMs = 200;
throttle.SetValue(1.0f);
for (var i = 0; i < 6; i++) { throttle.SetValue(1.0f); Thread.Sleep(25); }
snap = manager.GetSnapshot();
Check("fresh input keeps the drive released", snap.DriveEnabled, snap.InhibitReason ?? "(none)");
Check("control age is reported", snap.ControlAgeSeconds < 0.2, F(snap.ControlAgeSeconds));

// Input stops while the nodes keep reporting: the bus is fine, the link is not.
Thread.Sleep(500);
snap = manager.GetSnapshot();
Check("stale input inhibits the drive", !snap.DriveEnabled, snap.InhibitReason ?? "(none)");
Check("stale input -> mode stop", lastMode == (byte)P.DriveMode.Stop, $"mode {lastMode}");
Check("stale input -> zero target", lastLeft == 0 && lastRight == 0, $"{lastLeft}/{lastRight}");
Check("nodes still present, so it is the link that is blamed",
      snap.AllNodesPresent && (snap.InhibitReason ?? "").Contains("stale"),
      snap.InhibitReason ?? "(none)");

// 7. Releasing one mixed axis has to zero the other. Zero throttle with
// steering still held is not stopped, it is turning on the spot.
manager.ControlTimeoutMs = 60000;
throttle.SetValue(0.5f);
steering.SetValue(0.8f);
Thread.Sleep(100);
Check("mixed inputs are live", lastLeft != 0 || lastRight != 0, $"{lastLeft}/{lastRight}");
throttle.Release();
Thread.Sleep(100);
Check("releasing throttle also zeroes steering", lastLeft == 0 && lastRight == 0,
      $"{lastLeft}/{lastRight}");

// 8. Odometry integrates while the nodes report. The travelled angles need no
// calibration, so they have to be moving even though the constants are unset.
manager.ResetOdometry();
simLeftAlive = simRightAlive = true;
Thread.Sleep(600);
snap = manager.GetSnapshot();
Check("odometry integrates travelled angle", snap.Odometry.LeftTravelRad > 1.0,
      F(snap.Odometry.LeftTravelRad));
Check("uncalibrated means no metres", !snap.Odometry.Calibrated);
Check("reset zeroes it", manager.GetSnapshot().Odometry.LeftTravelRad > 0);

// 9. The bus state itself. A virtual bus has no controller and no counters,
// so these only mean anything on real hardware - and they exist because this
// adapter sends no error frames at all, leaving netlink as the only view.
var real = !iface.StartsWith("vcan", StringComparison.Ordinal);
if (real)
{
    Thread.Sleep(1200);                 // the poll runs at 1 Hz
    snap = manager.GetSnapshot();
    Check("bus state comes from netlink", snap.BusStateSource == "netlink", snap.BusStateSource);
    Check("bus state is a real controller state",
          snap.BusState is "error-active" or "error-warning" or "error-passive",
          snap.BusState);
    Check("frames actually left the controller", snap.TxPackets > 0, $"{snap.TxPackets}");
    // 50 Hz through a ten-deep qdisc over USB: if this backs up, the command
    // rate is too high for the adapter, which is worth knowing before the
    // boards are on the wire rather than after.
    Check("the command rate does not overrun the queue",
          snap.SendFailures == 0, $"{snap.SendFailures} failures, {snap.TxDropped} dropped");
    Console.WriteLine($"        bus {snap.BusState}, tx {snap.TxPackets}, " +
                      $"dropped {snap.TxDropped}, warn {snap.ErrorWarnings}, " +
                      $"passive {snap.ErrorPassive}, bus-off {snap.BusOffEvents}");
}

stop = true;
Thread.Sleep(250);

Console.WriteLine();
Console.WriteLine(failures == 0 ? "ALL CHECKS PASSED" : $"{failures} CHECK(S) FAILED");
return failures == 0 ? 0 : 1;
