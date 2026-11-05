using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Can;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control.ControlTypes;

/// <summary>
/// Base for every channel that feeds the CAN track drive. The channel only
/// deposits a value; the manager owns the 50 Hz command frame, because the
/// nodes' failsafe hangs on that period and SignalR only delivers on change.
/// </summary>
public abstract class TrackDriveControlBase : ControlTypeBase
{
    private ITrackDriveInput? _input;

    protected TrackDriveControlBase(ILogger logger)
    {
        Logger = logger;
    }

    protected ILogger Logger { get; }

    /// <summary>Which quantity this channel feeds. Fixed per control type
    /// rather than taken from the ChannelMap address, so a mis-set address
    /// cannot silently turn steering into throttle.</summary>
    protected abstract TrackDriveAxis Axis { get; }

    public override void Initialize()
    {
        _input = PinManager.GetModule<ITrackDriveInput>((int)Axis);
        Logger.LogDebug("Track drive channel {Name} bound to {Axis}.", Name, Axis);
        base.Initialize();
    }

    public override void OnControlRecived(decimal newValue)
    {
        if (_input == null)
        {
            Logger.LogError("Track drive channel {Name} used before Initialize.", Name);
            return;
        }
        _input.SetValue((float)newValue);
    }

    public override void OnControlReleased() => _input?.Release();

    public override string ToString() => $"{GetType().Name}[{Axis}]";
}

/// <summary>Forward and reverse. Mixed with steering inside the manager.</summary>
[ControlType("TrackThrottle")]
public class TrackThrottleControl : TrackDriveControlBase
{
    public TrackThrottleControl(ILogger<TrackThrottleControl> logger) : base(logger) { }
    protected override TrackDriveAxis Axis => TrackDriveAxis.Throttle;

    protected override async Task RunTestInternalAsync()
    {
        // Deliberately gentle and short: this spins both tracks. Anything
        // livelier belongs on a jacked-up vehicle, and TestDisabled exists for
        // exactly that reason.
        OnControlRecived(0.2m);
        await Task.Delay(1000);
        OnControlRecived(-0.2m);
        await Task.Delay(1000);
        OnControlReleased();
    }
}

/// <summary>Left and right. Positive turns one way, the manager decides which
/// by sign convention: positive steering speeds the left track up.</summary>
[ControlType("TrackSteering")]
public class TrackSteeringControl : TrackDriveControlBase
{
    public TrackSteeringControl(ILogger<TrackSteeringControl> logger) : base(logger) { }
    protected override TrackDriveAxis Axis => TrackDriveAxis.Steering;

    protected override async Task RunTestInternalAsync()
    {
        OnControlRecived(0.2m);
        await Task.Delay(1000);
        OnControlRecived(-0.2m);
        await Task.Delay(1000);
        OnControlReleased();
    }
}

/// <summary>Bypasses the mix and drives the left track directly. For bench work
/// and for anyone who would rather mix in the gamepad mapping. As soon as a
/// direct channel is used the mixed inputs are ignored, so do not configure
/// both for the same vehicle.</summary>
[ControlType("TrackLeft")]
public class TrackLeftControl : TrackDriveControlBase
{
    public TrackLeftControl(ILogger<TrackLeftControl> logger) : base(logger) { }
    protected override TrackDriveAxis Axis => TrackDriveAxis.Left;
}

/// <summary>Bypasses the mix and drives the right track directly.</summary>
[ControlType("TrackRight")]
public class TrackRightControl : TrackDriveControlBase
{
    public TrackRightControl(ILogger<TrackRightControl> logger) : base(logger) { }
    protected override TrackDriveAxis Axis => TrackDriveAxis.Right;
}

/// <summary>Momentary button. Asks the nodes to unlatch their fault, which only
/// the master may do - nothing on a node re-enables itself.</summary>
[ControlType("TrackFaultReset")]
public class TrackFaultResetControl : TrackDriveControlBase
{
    public TrackFaultResetControl(ILogger<TrackFaultResetControl> logger) : base(logger)
    {
        TestDisabled = true;
    }
    protected override TrackDriveAxis Axis => TrackDriveAxis.FaultReset;
}

/// <summary>Momentary button. Writes the flight recorder out.
///
/// The faults dump themselves. This is for the other half: the vehicle did
/// something odd and nothing tripped, which is exactly the case that is
/// impossible to reproduce later. Press it while the memory is fresh.</summary>
[ControlType("TrackRecordDump")]
public class TrackRecordDumpControl : TrackDriveControlBase
{
    public TrackRecordDumpControl(ILogger<TrackRecordDumpControl> logger) : base(logger)
    {
        TestDisabled = true;
    }
    protected override TrackDriveAxis Axis => TrackDriveAxis.RecordDump;
}

/// <summary>Momentary button. Zeroes the odometry, which is what the
/// calibration runs need between measurements.</summary>
[ControlType("TrackOdometryReset")]
public class TrackOdometryResetControl : TrackDriveControlBase
{
    public TrackOdometryResetControl(ILogger<TrackOdometryResetControl> logger) : base(logger)
    {
        TestDisabled = true;
    }
    protected override TrackDriveAxis Axis => TrackDriveAxis.OdometryReset;
}

/// <summary>
/// Lowers the speed limit while driving: a value in (0, 1] is the share of
/// maxSpeedRadPerSecond the stick reaches at full scale, and the nodes get the
/// same figure as their own cap (0x101). 0, negative or released means no
/// reduction, so use a slider from e.g. 0.1 to 1, or a toggle with value 0.3
/// as a crawl gear. Not part of the channel test.
/// </summary>
[ControlType("TrackSpeedLimit")]
public class TrackSpeedLimitControl : TrackDriveControlBase
{
    public TrackSpeedLimitControl(ILogger<TrackSpeedLimitControl> logger) : base(logger)
    {
        TestDisabled = true;
    }
    protected override TrackDriveAxis Axis => TrackDriveAxis.SpeedLimit;
}

/// <summary>Momentary button. Broadcasts an emergency stop to every node.
/// Never part of the channel test.</summary>
[ControlType("TrackEmergencyStop")]
public class TrackEmergencyStopControl : TrackDriveControlBase
{
    public TrackEmergencyStopControl(ILogger<TrackEmergencyStopControl> logger) : base(logger)
    {
        TestDisabled = true;
    }
    protected override TrackDriveAxis Axis => TrackDriveAxis.EmergencyStop;
}
