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
    /// <summary>Momentary: a nonzero value zeroes the odometry.</summary>
    OdometryReset = 6,
    /// <summary>Momentary: a nonzero value writes the flight recorder out.</summary>
    RecordDump = 7,
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

    /// <summary>d-axis current. The direct symptom of an angle error: with the
    /// electrical zero 120 degrees out this ran to -1.89 A while Iq still
    /// looked almost plausible.</summary>
    public double CurrentDAmps { get; init; }
    public double VoltageQVolts { get; init; }
    /// <summary>Share of hall sector changes that were immediate returns, over
    /// the last second. The project's main metric, and the one that decides
    /// whether the encoder retrofit is needed - now available during a drive
    /// instead of only on the bench.</summary>
    public int HallErrorPercent { get; init; }
    public int IsrMaxMicroseconds { get; init; }
    /// <summary>What the node's thermal model currently allows.</summary>
    public double CurrentLimitAmps { get; init; }
    public int DebounceSamples { get; init; }
}

/// <summary>
/// Where the vehicle has been, worked out from the two track speeds.
///
/// Split in two deliberately. The travelled angles need no calibration at all
/// and are available from the first metre: their DIFFERENCE is exactly the
/// quantity that says whether one track fell behind, which is what a trim
/// controller would act on and what nothing else measures.
///
/// Everything in metres needs the effective rolling radius and the effective
/// track width, and until those are measured <see cref="Calibrated"/> is false
/// and the metric fields stay at zero rather than carrying made-up numbers.
///
/// "Effective" is not a figure of speech: on a tracked vehicle slip makes the
/// behaviour match a track width 10 to 50 percent wider than the one you can
/// measure with a ruler. Both constants have to come from a driving
/// measurement, see Docs/CanTrackDrive.md.
/// </summary>
public sealed record TrackOdometry
{
    public bool Calibrated { get; init; }

    /// <summary>Angle each track has turned since the last reset, in radians.
    /// Vehicle coordinates: positive means it drove the vehicle forward.</summary>
    public double LeftTravelRad { get; init; }
    public double RightTravelRad { get; init; }

    /// <summary>Right minus left. Nonzero means the vehicle has turned, by
    /// accident or on purpose.</summary>
    public double TravelDifferenceRad { get; init; }

    public double SpeedMetersPerSecond { get; init; }
    /// <summary>Positive is a left turn, the usual right-handed convention.
    /// Note that positive STEERING speeds the left track up and therefore
    /// turns right, so the two signs are opposite by design.</summary>
    public double YawRateRadPerSecond { get; init; }

    public double X { get; init; }
    public double Y { get; init; }
    public double HeadingRad { get; init; }
    /// <summary>Path length, always growing - not the distance from the start.</summary>
    public double DistanceMeters { get; init; }
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

    /// <summary>Age of the newest control input. Infinite before the first one.</summary>
    public double ControlAgeSeconds { get; init; } = double.PositiveInfinity;
    public double CommandedLeft { get; init; }
    public double CommandedRight { get; init; }
    public CanTrackProtocol.DriveMode Mode { get; init; }

    public long FramesSent { get; init; }
    public long FramesReceived { get; init; }
    public long SendFailures { get; init; }
    public long UnknownFrames { get; init; }

    /// <summary>
    /// What the CAN controller thinks of the bus, from the error frames the
    /// kernel sends up. Worth having as telemetry rather than only in a log:
    /// "no nodes present" and "the wire is broken" look identical from the
    /// protocol's point of view, and only this tells them apart.
    /// </summary>
    public string BusState { get; init; } = "unknown";
    /// <summary>Nobody acknowledged a frame. With two nodes wired up this
    /// means the other end is not listening; on a bench with one device it is
    /// simply what an empty bus looks like.</summary>
    public long AckErrors { get; init; }
    public long ErrorWarnings { get; init; }
    public long ErrorPassive { get; init; }
    /// <summary>Bus-off. The controller has taken itself off the wire.
    /// Linux does NOT bring it back unless the interface was configured with
    /// restart-ms, and the default is 0 - see Docs/CanTrackDrive.md.</summary>
    public long BusOffEvents { get; init; }
    public long ControllerRestarts { get; init; }
    public bool BusOff { get; init; }

    public required TrackOdometry Odometry { get; init; }
}
