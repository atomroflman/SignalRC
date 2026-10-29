namespace SignalRC.Onboard.Hardware.Can;

/// <summary>
/// Which quantity a control channel feeds into the drive manager.
///
/// Throttle and Steering are mixed into the two track speeds by the manager,
/// not by the browser. The mix has to stay consistent even when only one of
/// the two channels changes, and the manager already holds both values for its
/// periodic command frame, so it is the only place that always has both.
///
/// Left and Right bypass the mix for bench testing and for anyone who would
/// rather mix in the gamepad mapping.
/// </summary>
public enum TrackDriveAxis
{
    Throttle = 0,
    Steering = 1,
    Left = 2,
    Right = 3,
    /// <summary>Momentary: a nonzero value asks the nodes to unlatch their fault.</summary>
    FaultReset = 4,
    /// <summary>Momentary: a nonzero value broadcasts an emergency stop.</summary>
    EmergencyStop = 5,
}

/// <summary>One input into the drive manager. Values run -1..1 like every other
/// control channel in this project.</summary>
public interface ITrackDriveInput : IModule
{
    void SetValue(float value);
    void Release();
}

/// <summary>Immutable copy of one node's last reported state.</summary>
public sealed record TrackNodeState
{
    public int Node { get; init; }
    public bool Seen { get; init; }
    public double AgeSeconds { get; init; } = double.PositiveInfinity;

    public double SpeedRadPerSecond { get; init; }
    public double TargetRadPerSecond { get; init; }
    public CanTrackProtocol.NodeState State { get; init; }
    public CanTrackProtocol.StatusFlags Flags { get; init; }
    public double CurrentQAmps { get; init; }

    public double BusVolts { get; init; }
    public double BusAmps { get; init; }
    public double PowerWatts { get; init; }
    /// <summary>Null when the node reports no valid thermistor reading.</summary>
    public double? TemperatureCelsius { get; init; }
    public double ThermalUtilisation { get; init; }

    public CanTrackProtocol.FaultCode Fault { get; init; }
    public TimeSpan FaultUptime { get; init; }
}

/// <summary>Everything the telemetry reader and the diagnostics need, taken
/// under one lock so the two nodes are always from the same instant.</summary>
public sealed record TrackDriveSnapshot
{
    public required TrackNodeState Left { get; init; }
    public required TrackNodeState Right { get; init; }

    public bool BusUp { get; init; }
    public bool AllNodesPresent { get; init; }
    public bool DriveEnabled { get; init; }
    public string? InhibitReason { get; init; }

    public double CommandedLeft { get; init; }
    public double CommandedRight { get; init; }
    public CanTrackProtocol.DriveMode Mode { get; init; }

    public long FramesSent { get; init; }
    public long FramesReceived { get; init; }
    public long SendFailures { get; init; }
    public long UnknownFrames { get; init; }
}
