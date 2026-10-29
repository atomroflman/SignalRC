using System.Globalization;
using SignalRC.Onboard.Hardware.Can;
using Microsoft.Extensions.Logging;

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

        var snapshot = manager.GetSnapshot();
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

        return Task.FromResult<IReadOnlyDictionary<string, string>?>(values);
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
