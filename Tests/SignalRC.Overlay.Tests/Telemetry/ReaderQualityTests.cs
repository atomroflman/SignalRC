using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Can;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

// Quality mapping of the readers from snapshot types only - no bus, no serial
// port, no jbdtool. CpuTemperatureReader reads sysfs/vcgencmd and is not
// covered here.
public class ReaderQualityTests
{
    private const double Timeout = 0.25;

    private static TrackNodeState Node(bool seen, double ageSeconds, double? temperature = 25.0) => new()
    {
        Seen = seen,
        AgeSeconds = seen ? ageSeconds : double.PositiveInfinity,
        TemperatureCelsius = temperature,
    };

    private static TrackDriveSnapshot Snapshot(TrackNodeState left, TrackNodeState right,
        bool busOff = false, double controlAge = 0.05, bool calibrated = false) => new()
    {
        Left = left,
        Right = right,
        BusOff = busOff,
        ControlAgeSeconds = controlAge,
        Odometry = new TrackOdometry { Calibrated = calibrated },
    };

    [Fact]
    public void CanFreshNodesAreValidWithNodeAge()
    {
        var s = CanTrackDriveTelemetryReader.BuildSamples(Snapshot(Node(true, 0.04), Node(true, 0.06)), Timeout);
        Assert.Equal(new TelemetrySample("0", TelemetrySampleState.Valid, 40), s["leftSpeed"]);
        Assert.Equal(TelemetrySampleState.Valid, s["rightCurrent"].State);
        Assert.Equal(60, s["rightCurrent"].AgeMs);
        // Odometry takes the older node.
        Assert.Equal(new TelemetrySample("0", TelemetrySampleState.Valid, 60), s["odoTravelDiff"]);
        Assert.Equal(TelemetrySampleState.Valid, s["controlAge"].State);
        Assert.Equal(TelemetrySampleState.Valid, s["busOff"].State);
    }

    [Fact]
    public void CanStaleAndMissingNodes()
    {
        var s = CanTrackDriveTelemetryReader.BuildSamples(Snapshot(Node(true, 0.8), Node(false, 0)), Timeout);
        Assert.Equal(TelemetrySampleState.Stale, s["leftSpeed"].State);
        Assert.Equal(800, s["leftSpeed"].AgeMs);
        Assert.Equal(TelemetrySampleState.NoData, s["rightSpeed"].State);
        // Present is judged now.
        Assert.Equal(new TelemetrySample("0", TelemetrySampleState.Valid, 0), s["rightPresent"]);
        Assert.Equal(TelemetrySampleState.NoData, s["odoLeftTravel"].State);
    }

    [Fact]
    public void CanBusOffIsErrorForNodeValuesOnly()
    {
        var s = CanTrackDriveTelemetryReader.BuildSamples(Snapshot(Node(true, 0.1), Node(true, 0.1), busOff: true), Timeout);
        Assert.Equal(TelemetrySampleState.Error, s["leftSpeed"].State);
        Assert.Equal(TelemetrySampleState.Error, s["odoTravelDiff"].State);
        Assert.Equal(TelemetrySampleState.Valid, s["busOff"].State);
        Assert.Equal(TelemetrySampleState.Valid, s["framesSent"].State);
    }

    [Fact]
    public void CanUncalibratedOdometryNoControlAndBadThermistor()
    {
        var s = CanTrackDriveTelemetryReader.BuildSamples(
            Snapshot(Node(true, 0.01, temperature: null), Node(true, 0.01), controlAge: double.PositiveInfinity), Timeout);
        Assert.Equal(new TelemetrySample("", TelemetrySampleState.NoData, 0), s["odoSpeed"]);
        Assert.Equal(new TelemetrySample("", TelemetrySampleState.NoData, 0), s["controlAge"]);
        Assert.Equal(TelemetrySampleState.Error, s["leftTemperature"].State);
        Assert.Equal(TelemetrySampleState.Valid, s["rightTemperature"].State);

        var calibrated = CanTrackDriveTelemetryReader.BuildSamples(
            Snapshot(Node(true, 0.01), Node(true, 0.01), calibrated: true), Timeout);
        Assert.Equal(TelemetrySampleState.Valid, calibrated["odoSpeed"].State);
        Assert.Equal(new TelemetrySample("", TelemetrySampleState.NoData, 0), s["odoLeftSpeed"]);
    }

    [Fact]
    public void CanPerTrackSpeedInMetresFollowsItsOwnNode()
    {
        var snapshot = Snapshot(Node(true, 0.01), Node(true, 0.8), calibrated: true) with
        {
            Odometry = new TrackOdometry { Calibrated = true, LeftSpeedMetersPerSecond = 1.25, RightSpeedMetersPerSecond = -0.5 },
        };
        var s = CanTrackDriveTelemetryReader.BuildSamples(snapshot, Timeout);
        Assert.Equal(new TelemetrySample("1.25", TelemetrySampleState.Valid, 10), s["odoLeftSpeed"]);
        Assert.Equal(new TelemetrySample("-0.5", TelemetrySampleState.Stale, 800), s["odoRightSpeed"]);
    }

    [Fact]
    public void CanLegacyValuesUnchanged()
    {
        var snapshot = Snapshot(Node(true, 0.01), Node(false, 0), controlAge: double.PositiveInfinity);
        var values = CanTrackDriveTelemetryReader.BuildValues(snapshot);
        var samples = CanTrackDriveTelemetryReader.BuildSamples(snapshot, Timeout);
        Assert.Equal(values.OrderBy(kv => kv.Key), samples.Select(kv => KeyValuePair.Create(kv.Key, kv.Value.Value)).OrderBy(kv => kv.Key));
        Assert.Equal("", values["controlAge"]);
    }

    private sealed class NoFactory : IModuleManagerFactory
    {
        public IModuleManager Create(string name) => throw new NotSupportedException();
    }

    private static Dictionary<string, TelemetrySample> Lidar(LidarHealth health, bool hasScan = true)
    {
        var reader = new LidarTelemetryReader(NullLogger<LidarTelemetryReader>.Instance, new NoFactory());
        // The scan itself only affects the values, not their quality.
        return LidarTelemetryReader.BuildSamples(reader.BuildValues(health, null), health, hasScan);
    }

    [Fact]
    public void LidarSpinningIsValidWithScanAge()
    {
        var s = Lidar(new LidarHealth { PortOpen = true, Spinning = true, ScanAgeSeconds = 0.12 });
        Assert.Equal(TelemetrySampleState.Valid, s["lidarSectors"].State);
        Assert.Equal(120, s["lidarSectors"].AgeMs);
        Assert.Equal(new TelemetrySample("1", TelemetrySampleState.Valid, 0), s["lidarOk"]);
    }

    [Fact]
    public void LidarStandstillIsStale()
    {
        var s = Lidar(new LidarHealth { PortOpen = true, Spinning = false, ScanAgeSeconds = 3 });
        Assert.Equal(TelemetrySampleState.Stale, s["lidarNearest"].State);
        Assert.Equal(3000, s["lidarNearest"].AgeMs);
    }

    [Fact]
    public void LidarPortClosedOrProblemIsError()
    {
        Assert.Equal(TelemetrySampleState.Error,
            Lidar(new LidarHealth { PortOpen = false, Spinning = true, ScanAgeSeconds = 0.1 })["lidarFront"].State);
        Assert.Equal(TelemetrySampleState.Error,
            Lidar(new LidarHealth { PortOpen = true, Spinning = true, ScanAgeSeconds = 0.1, Problem = "x" })["lidarFront"].State);
    }

    [Fact]
    public void LidarWithoutScanIsNoData()
    {
        var s = Lidar(new LidarHealth { PortOpen = true }, hasScan: false);
        Assert.Equal(TelemetrySampleState.NoData, s["lidarSectors"].State);
        Assert.Equal(TelemetrySampleState.NoData, s["lidarAge"].State);
        Assert.Equal(TelemetrySampleState.Valid, s["lidarScans"].State);
    }

    [Fact]
    public void BmsFreshCachedFailedAndNever()
    {
        var now = new DateTime(2026, 11, 2, 12, 0, 0, DateTimeKind.Utc);
        var values = new Dictionary<string, string> { ["soc"] = "80" };

        var fresh = JbdBmsTelemetryReader.BuildSamples(values, values, now.AddMilliseconds(-1500), now)!;
        Assert.Equal(new TelemetrySample("80", TelemetrySampleState.Valid, 1500), fresh["soc"]);

        var failed = JbdBmsTelemetryReader.BuildSamples(null, values, now.AddSeconds(-10), now)!;
        Assert.Equal(new TelemetrySample("80", TelemetrySampleState.Error, 10000), failed["soc"]);

        Assert.Null(JbdBmsTelemetryReader.BuildSamples(null, null, null, now));
    }

    [Fact]
    public async Task ApplicationLifetimeIsValid()
    {
        var reader = new ApplicationLifetimeReader(NullLogger<ApplicationLifetimeReader>.Instance);
        var s = await reader.ReadAllSamplesAsync("uptime");
        Assert.Equal(TelemetrySampleState.Valid, s!["uptime"].State);
        Assert.Equal(0, s["uptime"].AgeMs);
    }

    [Fact]
    public async Task StoreBackedStaysUnchecked()
    {
        var store = new TelemetryStore();
        store.Set("x", "1");
        var reader = new StoreBackedTelemetryReader(NullLogger<StoreBackedTelemetryReader>.Instance, store);
        Assert.Equal(new TelemetrySample("1", TelemetrySampleState.Unchecked, 0), (await reader.ReadAllSamplesAsync("x"))!["x"]);
        Assert.Null(await reader.ReadAllSamplesAsync("missing"));
    }
}
