using SignalRC.Shared.Channels;
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
// Suggested channel types; TelemetryValueHintTests checks that every key of BuildValues is listed.
[TelemetryValue("leftPresent", TelemetryDataType.Boolean)]
[TelemetryValue("leftSpeed", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("leftTarget", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("leftState", TelemetryDataType.String)]
[TelemetryValue("leftCurrent", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("leftBusVolts", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("leftBusAmps", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("leftPower", TelemetryDataType.Number, "W", Decimals = 1)]
[TelemetryValue("leftTemperature", TelemetryDataType.Number, "°C", Decimals = 0)]
[TelemetryValue("leftThermal", TelemetryDataType.Number, "%", Decimals = 0)]
[TelemetryValue("leftCurrentD", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("leftVoltageQ", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("leftHallError", TelemetryDataType.Integer, "%", Decimals = 0)]
[TelemetryValue("leftIsrMax", TelemetryDataType.Integer, "µs", Decimals = 0)]
[TelemetryValue("leftCurrentLimit", TelemetryDataType.Number, "A", Decimals = 1)]
[TelemetryValue("leftDebounce", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("leftFault", TelemetryDataType.String)]
[TelemetryValue("leftFaultCode", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("leftDerating", TelemetryDataType.Boolean)]
[TelemetryValue("leftCurrentLimited", TelemetryDataType.Boolean)]
[TelemetryValue("leftUnderVoltageWarning", TelemetryDataType.Boolean)]
[TelemetryValue("leftShortBrake", TelemetryDataType.Boolean)]
[TelemetryValue("leftBrakeTripped", TelemetryDataType.Boolean)]
[TelemetryValue("leftFailsafe", TelemetryDataType.Boolean)]
[TelemetryValue("leftVoltageLimited", TelemetryDataType.Boolean)]
[TelemetryValue("leftTemperatureWarning", TelemetryDataType.Boolean)]
[TelemetryValue("leftSpeedLimit", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("leftUsableVolts", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("leftLimitReasons", TelemetryDataType.String)]
[TelemetryValue("leftSpeedCapped", TelemetryDataType.Boolean)]
[TelemetryValue("leftLimitsAcked", TelemetryDataType.Boolean)]
[TelemetryValue("rightPresent", TelemetryDataType.Boolean)]
[TelemetryValue("rightSpeed", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("rightTarget", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("rightState", TelemetryDataType.String)]
[TelemetryValue("rightCurrent", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("rightBusVolts", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("rightBusAmps", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("rightPower", TelemetryDataType.Number, "W", Decimals = 1)]
[TelemetryValue("rightTemperature", TelemetryDataType.Number, "°C", Decimals = 0)]
[TelemetryValue("rightThermal", TelemetryDataType.Number, "%", Decimals = 0)]
[TelemetryValue("rightCurrentD", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("rightVoltageQ", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("rightHallError", TelemetryDataType.Integer, "%", Decimals = 0)]
[TelemetryValue("rightIsrMax", TelemetryDataType.Integer, "µs", Decimals = 0)]
[TelemetryValue("rightCurrentLimit", TelemetryDataType.Number, "A", Decimals = 1)]
[TelemetryValue("rightDebounce", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("rightFault", TelemetryDataType.String)]
[TelemetryValue("rightFaultCode", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("rightDerating", TelemetryDataType.Boolean)]
[TelemetryValue("rightCurrentLimited", TelemetryDataType.Boolean)]
[TelemetryValue("rightUnderVoltageWarning", TelemetryDataType.Boolean)]
[TelemetryValue("rightShortBrake", TelemetryDataType.Boolean)]
[TelemetryValue("rightBrakeTripped", TelemetryDataType.Boolean)]
[TelemetryValue("rightFailsafe", TelemetryDataType.Boolean)]
[TelemetryValue("rightVoltageLimited", TelemetryDataType.Boolean)]
[TelemetryValue("rightTemperatureWarning", TelemetryDataType.Boolean)]
[TelemetryValue("rightSpeedLimit", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("rightUsableVolts", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("rightLimitReasons", TelemetryDataType.String)]
[TelemetryValue("rightSpeedCapped", TelemetryDataType.Boolean)]
[TelemetryValue("rightLimitsAcked", TelemetryDataType.Boolean)]
[TelemetryValue("busUp", TelemetryDataType.Boolean)]
[TelemetryValue("nodesPresent", TelemetryDataType.Boolean)]
[TelemetryValue("driveEnabled", TelemetryDataType.Boolean)]
[TelemetryValue("inhibit", TelemetryDataType.String)]
[TelemetryValue("controlAge", TelemetryDataType.Number, "s", Decimals = 2)]
[TelemetryValue("mode", TelemetryDataType.String)]
[TelemetryValue("commandLeft", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("commandRight", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("speedLimit", TelemetryDataType.Number, "rad/s", Decimals = 2)]
[TelemetryValue("speedLimitFactor", TelemetryDataType.Number, "%", Decimals = 0)]
[TelemetryValue("currentLimitRequest", TelemetryDataType.Number, "A", Decimals = 1)]
[TelemetryValue("currentLimitFactor", TelemetryDataType.Number, "%", Decimals = 0)]
[TelemetryValue("freewheel", TelemetryDataType.Boolean)]
[TelemetryValue("brakeRearms", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("odoLeftTravel", TelemetryDataType.Number, "rad", Decimals = 1)]
[TelemetryValue("odoRightTravel", TelemetryDataType.Number, "rad", Decimals = 1)]
[TelemetryValue("odoTravelDiff", TelemetryDataType.Number, "rad", Decimals = 1)]
[TelemetryValue("odoCalibrated", TelemetryDataType.Boolean)]
[TelemetryValue("odoSpeed", TelemetryDataType.Number, "m/s", Decimals = 2)]
[TelemetryValue("odoLeftSpeed", TelemetryDataType.Number, "m/s", Decimals = 2)]
[TelemetryValue("odoRightSpeed", TelemetryDataType.Number, "m/s", Decimals = 2)]
[TelemetryValue("odoYawRate", TelemetryDataType.Number, "°/s", Decimals = 1)]
[TelemetryValue("odoHeading", TelemetryDataType.Number, "°", Decimals = 0)]
[TelemetryValue("odoDistance", TelemetryDataType.Number, "m", Decimals = 1)]
[TelemetryValue("odoX", TelemetryDataType.Number, "m", Decimals = 2)]
[TelemetryValue("odoY", TelemetryDataType.Number, "m", Decimals = 2)]
[TelemetryValue("framesSent", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("framesReceived", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("sendFailures", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("busState", TelemetryDataType.String)]
[TelemetryValue("busOff", TelemetryDataType.Boolean)]
[TelemetryValue("ackErrors", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("busOffEvents", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("busRestarts", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("busStateSource", TelemetryDataType.String)]
[TelemetryValue("txDropped", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("txPackets", TelemetryDataType.Integer, Decimals = 0)]
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
        // What the master asks for in 0x101. Empty means no request.
        values["speedLimit"] = snapshot.RequestedSpeedLimit.HasValue
            ? Num(snapshot.RequestedSpeedLimit.Value) : string.Empty;
        values["speedLimitFactor"] = Num(snapshot.SpeedLimitFactor * 100.0);
        values["currentLimitRequest"] = snapshot.RequestedCurrentLimit.HasValue
            ? Num(snapshot.RequestedCurrentLimit.Value) : string.Empty;
        values["currentLimitFactor"] = Num(snapshot.CurrentLimitFactor * 100.0);
        values["freewheel"] = snapshot.Freewheel ? "1" : "0";
        values["brakeRearms"] = snapshot.BrakeRearms.ToString(CultureInfo.InvariantCulture);
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
        // Per track in m/s. leftSpeed/rightSpeed are motor rad/s, which is not
        // what a speed display or the track-run overlay expects.
        values["odoLeftSpeed"] = odo.Calibrated ? Num(odo.LeftSpeedMetersPerSecond) : string.Empty;
        values["odoRightSpeed"] = odo.Calibrated ? Num(odo.RightSpeedMetersPerSecond) : string.Empty;
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
    /// the metric fields are NoData while uncalibrated. <c>odoLeftSpeed</c>/
    /// <c>odoRightSpeed</c> follow their own node only.</item>
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

        // A track's own speed depends on that node only.
        var calibrated = snapshot.Odometry.Calibrated;
        Set(samples, "odoLeftSpeed", calibrated ? left : (TelemetrySampleState.NoData, 0));
        Set(samples, "odoRightSpeed", calibrated ? right : (TelemetrySampleState.NoData, 0));

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
        // No limits frame yet: firmware before 2026-11-05, or just not arrived.
        foreach (var key in new[] { $"{prefix}SpeedLimit", $"{prefix}UsableVolts" })
        {
            if (quality.State == TelemetrySampleState.Valid && samples[key].Value.Length == 0)
            {
                Set(samples, key, (TelemetrySampleState.NoData, 0));
            }
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
        values[$"{prefix}ShortBrake"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.ShortBrake) ? "1" : "0";
        values[$"{prefix}BrakeTripped"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.BrakeTripped) ? "1" : "0";
        values[$"{prefix}Failsafe"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.Failsafe) ? "1" : "0";
        // Set since firmware 2026-11-05: the back-EMF has reached what the
        // inverter can produce, i.e. top speed at this battery voltage.
        values[$"{prefix}VoltageLimited"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.VoltageLimited) ? "1" : "0";
        values[$"{prefix}TemperatureWarning"] =
            node.Flags.HasFlag(CanTrackProtocol.StatusFlags.TemperatureWarning) ? "1" : "0";

        // From 0x185/0x195, firmware 2026-11-05 and later. Empty before the
        // first such frame, so an old firmware shows nothing instead of zeros.
        values[$"{prefix}SpeedLimit"] = node.LimitsSeen ? Num(node.SpeedLimitRadPerSecond) : string.Empty;
        values[$"{prefix}UsableVolts"] = node.LimitsSeen ? Num(node.UsableVolts) : string.Empty;
        values[$"{prefix}LimitReasons"] = CanTrackProtocol.Describe(node.LimitReasons);
        values[$"{prefix}SpeedCapped"] =
            node.LimitReasons.HasFlag(CanTrackProtocol.LimitReasons.SpeedCapped) ? "1" : "0";
        values[$"{prefix}LimitsAcked"] = node.LimitRequestAcknowledged ? "1" : "0";
    }

    private static string Num(double value)
        => value.ToString("0.###", CultureInfo.InvariantCulture);
}
