using System.Globalization;
using SignalRC.Onboard.Hardware.Can;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Publishes everything the two drive nodes report.
///
/// A multi-channel reader like the JBD BMS one: a single instance serves all
/// drive channels that share a groupKey, reads once per tick and returns every
/// field. Configure the channels with the same groupKey so the bus is read
/// once, not once per displayed value.
///
/// The reader does not open the bus itself. It asks the factory for the
/// pinManager named in <see cref="PinManager"/>, which hands back the very
/// instance the control channels already drive - the factory caches by name.
/// Telemetry therefore always reflects the manager that is actually steering.
/// </summary>
public class CanTrackDriveTelemetryReader : TelemetryReaderBase
{
    private readonly IModuleManagerFactory _factory;
    private CanTrackDriveManager? _manager;
    private bool _warned;

    /// <summary>Name of the pinManager entry in the ChannelMap, the same name
    /// the control channels use.</summary>
    public string PinManager { get; set; } = "trackDrive";

    public CanTrackDriveTelemetryReader(
        ILogger<CanTrackDriveTelemetryReader> logger,
        IModuleManagerFactory factory) : base(logger)
    {
        _factory = factory;
    }

    public override Task<string> ReadTelemetry() => Task.FromResult(string.Empty);

    public override Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var manager = Resolve();
        if (manager == null)
        {
            return Task.FromResult<IReadOnlyDictionary<string, string>?>(null);
        }

        return Task.FromResult<IReadOnlyDictionary<string, string>?>(BuildValues(manager.GetSnapshot()));
    }

    public override Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var manager = Resolve();
        if (manager == null)
        {
            return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(null);
        }
        var samples = BuildSamples(manager.GetSnapshot(), manager.NodeTimeoutMs / 1000.0);
        return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(samples);
    }

    /// <summary>The plain values of one snapshot (legacy view).</summary>
    public static Dictionary<string, string> BuildValues(TrackDriveSnapshot snapshot)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);

        AddNode(values, "left", snapshot.Left);
        AddNode(values, "right", snapshot.Right);

        values["busUp"] = snapshot.BusUp ? "1" : "0";
        values["nodesPresent"] = snapshot.AllNodesPresent ? "1" : "0";
        values["driveEnabled"] = snapshot.DriveEnabled ? "1" : "0";
        values["inhibit"] = snapshot.InhibitReason ?? string.Empty;
        // How stale the newest control input is. The single most useful number
        // when the vehicle stutters: it separates a bad network link from a
        // drive problem, and nothing else on the page shows it.
        values["controlAge"] = double.IsInfinity(snapshot.ControlAgeSeconds)
            ? string.Empty : Num(snapshot.ControlAgeSeconds);
        values["mode"] = snapshot.Mode.ToString();
        values["commandLeft"] = Num(snapshot.CommandedLeft);
        values["commandRight"] = Num(snapshot.CommandedRight);
        var odo = snapshot.Odometry;
        // Available from the first metre, no calibration needed. The difference
        // is the one number that says whether a track fell behind.
        values["odoLeftTravel"] = Num(odo.LeftTravelRad);
        values["odoRightTravel"] = Num(odo.RightTravelRad);
        values["odoTravelDiff"] = Num(odo.TravelDifferenceRad);
        values["odoCalibrated"] = odo.Calibrated ? "1" : "0";
        // Empty rather than zero while uncalibrated: a speed of "0.0 m/s" on a
        // moving vehicle is worse than an empty field.
        values["odoSpeed"] = odo.Calibrated ? Num(odo.SpeedMetersPerSecond) : string.Empty;
        values["odoYawRate"] = odo.Calibrated ? Num(odo.YawRateRadPerSecond * 180.0 / Math.PI) : string.Empty;
        values["odoHeading"] = odo.Calibrated ? Num(odo.HeadingRad * 180.0 / Math.PI) : string.Empty;
        values["odoDistance"] = odo.Calibrated ? Num(odo.DistanceMeters) : string.Empty;
        values["odoX"] = odo.Calibrated ? Num(odo.X) : string.Empty;
        values["odoY"] = odo.Calibrated ? Num(odo.Y) : string.Empty;

        values["framesSent"] = snapshot.FramesSent.ToString(CultureInfo.InvariantCulture);
        values["framesReceived"] = snapshot.FramesReceived.ToString(CultureInfo.InvariantCulture);
        values["sendFailures"] = snapshot.SendFailures.ToString(CultureInfo.InvariantCulture);
        // The controller's own view of the wire. Without it an empty bus and a
        // broken one are indistinguishable: both just produce no telemetry.
        values["busState"] = snapshot.BusState;
        values["busOff"] = snapshot.BusOff ? "1" : "0";
        values["ackErrors"] = snapshot.AckErrors.ToString(CultureInfo.InvariantCulture);
        values["busOffEvents"] = snapshot.BusOffEvents.ToString(CultureInfo.InvariantCulture);
        values["busRestarts"] = snapshot.ControllerRestarts.ToString(CultureInfo.InvariantCulture);
        values["busStateSource"] = snapshot.BusStateSource;
        // Climbing txDropped with txPackets standing still is being alone on
        // the bus - the one failure that looks exactly like a broken wire.
        values["txDropped"] = snapshot.TxDropped.ToString(CultureInfo.InvariantCulture);
        values["txPackets"] = snapshot.TxPackets.ToString(CultureInfo.InvariantCulture);

        return values;
    }

    /// <summary>
    /// The values of one snapshot with their quality (telemetry/README.md §3):
    /// <list type="bullet">
    /// <item>Node values (<c>left*</c>/<c>right*</c>) are as old as the node's
    /// last frame: NoData before its first frame, Error while the bus is off,
    /// Stale once older than the manager's node timeout, else Valid. An empty
    /// temperature (thermistor open/shorted) is an Error of its own.
    /// <c>*Present</c> is judged now and therefore Valid.</item>
    /// <item>Odometry depends on both nodes and takes the worse of the two;
    /// the metric fields are NoData while uncalibrated.</item>
    /// <item><c>controlAge</c> is NoData before the first control input.</item>
    /// <item>Everything else (bus state, counters, commanded values, mode,
    /// inhibit) is the manager's own state at snapshot time: Valid, age 0.</item>
    /// </list>
    /// </summary>
    public static Dictionary<string, TelemetrySample> BuildSamples(TrackDriveSnapshot snapshot, double nodeTimeoutSeconds)
    {
        var values = BuildValues(snapshot);
        var samples = new Dictionary<string, TelemetrySample>(values.Count, StringComparer.Ordinal);
        foreach (var (key, value) in values)
        {
            samples[key] = TelemetrySample.Valid(value);
        }

        var left = NodeQuality(snapshot.Left, snapshot.BusOff, nodeTimeoutSeconds);
        var right = NodeQuality(snapshot.Right, snapshot.BusOff, nodeTimeoutSeconds);
        ApplyNode(samples, "left", left);
        ApplyNode(samples, "right", right);

        var odo = Worse(left, right);
        foreach (var key in OdometryTravelKeys) Set(samples, key, odo);
        foreach (var key in OdometryMetricKeys)
        {
            Set(samples, key, snapshot.Odometry.Calibrated ? odo : (TelemetrySampleState.NoData, 0));
        }

        if (double.IsInfinity(snapshot.ControlAgeSeconds))
        {
            Set(samples, "controlAge", (TelemetrySampleState.NoData, 0));
        }
        return samples;
    }

    private static readonly string[] OdometryTravelKeys = ["odoLeftTravel", "odoRightTravel", "odoTravelDiff"];
    private static readonly string[] OdometryMetricKeys = ["odoSpeed", "odoYawRate", "odoHeading", "odoDistance", "odoX", "odoY"];

    private static (TelemetrySampleState State, int AgeMs) NodeQuality(TrackNodeState node, bool busOff, double timeoutSeconds)
    {
        if (!node.Seen || double.IsInfinity(node.AgeSeconds)) return (TelemetrySampleState.NoData, 0);
        var age = TelemetrySample.AgeFromSeconds(node.AgeSeconds);
        if (busOff) return (TelemetrySampleState.Error, age);
        if (node.AgeSeconds > timeoutSeconds) return (TelemetrySampleState.Stale, age);
        return (TelemetrySampleState.Valid, age);
    }

    // Error beats NoData beats Stale beats Valid; the age is the older one.
    private static (TelemetrySampleState State, int AgeMs) Worse(
        (TelemetrySampleState State, int AgeMs) a, (TelemetrySampleState State, int AgeMs) b)
    {
        static int Rank(TelemetrySampleState s) => s switch
        {
            TelemetrySampleState.Error => 3,
            TelemetrySampleState.NoData => 2,
            TelemetrySampleState.Stale => 1,
            _ => 0,
        };
        var state = Rank(a.State) >= Rank(b.State) ? a.State : b.State;
        return (state, Math.Max(a.AgeMs, b.AgeMs));
    }

    private static void ApplyNode(Dictionary<string, TelemetrySample> samples, string prefix,
        (TelemetrySampleState State, int AgeMs) quality)
    {
        var present = $"{prefix}Present";
        var temperature = $"{prefix}Temperature";
        foreach (var key in samples.Keys.Where(k => k.StartsWith(prefix, StringComparison.Ordinal)).ToList())
        {
            if (key == present) continue;
            Set(samples, key, quality);
        }
        // The node reported, but not a usable temperature: a sensor fault.
        if (quality.State == TelemetrySampleState.Valid && samples[temperature].Value.Length == 0)
        {
            Set(samples, temperature, (TelemetrySampleState.Error, quality.AgeMs));
        }
    }

    private static void Set(Dictionary<string, TelemetrySample> samples, string key,
        (TelemetrySampleState State, int AgeMs) quality)
    {
        if (samples.TryGetValue(key, out var sample))
        {
            samples[key] = sample with { State = quality.State, AgeMs = quality.AgeMs };
        }
    }

    private CanTrackDriveManager? Resolve()
    {
        if (_manager != null) return _manager;

        // Create() returns the cached instance for a name it has already built,
        // so this binds to the same manager the control channels use rather
        // than opening a second socket.
        if (_factory.Create(PinManager) is CanTrackDriveManager manager)
        {
            _manager = manager;
            manager.EnsureStarted();
            return manager;
        }

        if (!_warned)
        {
            _warned = true;
            Logger.LogError(
                "pinManager '{Name}' is not a CanTrackDriveManager. Check the ChannelMap: " +
                "the telemetry channel's pinManager option has to name the same entry the " +
                "drive channels use.", PinManager);
        }
        return null;
    }

    private static void AddNode(IDictionary<string, string> values, string prefix, TrackNodeState node)
    {
        values[$"{prefix}Present"] = node.Seen && node.AgeSeconds < 1.0 ? "1" : "0";
        values[$"{prefix}Speed"] = Num(node.SpeedRadPerSecond);
        values[$"{prefix}Target"] = Num(node.TargetRadPerSecond);
        values[$"{prefix}State"] = node.State.ToString();
        values[$"{prefix}Current"] = Num(node.CurrentQAmps);
        values[$"{prefix}BusVolts"] = Num(node.BusVolts);
        values[$"{prefix}BusAmps"] = Num(node.BusAmps);
        values[$"{prefix}Power"] = Num(node.PowerWatts);
        // Empty rather than a placeholder number: the node reports -128 when the
        // thermistor reads open or shorted, and showing that as a temperature
        // would be worse than showing nothing.
        values[$"{prefix}Temperature"] = node.TemperatureCelsius.HasValue
            ? Num(node.TemperatureCelsius.Value) : string.Empty;
        values[$"{prefix}Thermal"] = Num(node.ThermalUtilisation * 100.0);
        values[$"{prefix}CurrentD"] = Num(node.CurrentDAmps);
        values[$"{prefix}VoltageQ"] = Num(node.VoltageQVolts);
        values[$"{prefix}HallError"] = node.HallErrorPercent.ToString(CultureInfo.InvariantCulture);
        values[$"{prefix}IsrMax"] = node.IsrMaxMicroseconds.ToString(CultureInfo.InvariantCulture);
        values[$"{prefix}CurrentLimit"] = Num(node.CurrentLimitAmps);
        values[$"{prefix}Debounce"] = node.DebounceSamples.ToString(CultureInfo.InvariantCulture);
        values[$"{prefix}Fault"] = CanTrackProtocol.Describe(node.Fault);
        values[$"{prefix}FaultCode"] = ((byte)node.Fault).ToString(CultureInfo.InvariantCulture);
        values[$"{prefix}Derating"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.ThermalDerating) ? "1" : "0";
        values[$"{prefix}CurrentLimited"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.CurrentLimited) ? "1" : "0";
        values[$"{prefix}UnderVoltageWarning"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.UnderVoltageWarning) ? "1" : "0";
    }

    private static string Num(double value)
        => value.ToString("0.###", CultureInfo.InvariantCulture);
}
