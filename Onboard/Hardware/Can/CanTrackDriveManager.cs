using System.Diagnostics;
using Microsoft.Extensions.Logging;
using SocketCANSharp;
using SocketCANSharp.Network;
using SocketCANSharp.Network.Netlink;

namespace SignalRC.Onboard.Hardware.Can;

/// <summary>
/// Drives two MKS XDrive Mini nodes over SocketCAN and collects their telemetry.
///
/// This is an <see cref="IModuleManager"/> like the PCA9685 extension, so it is
/// configured as a pinManager in the ChannelMap and the control channels bind
/// to it through <see cref="GetModule{T}"/>.
///
/// Two things make it different from a PWM manager, and both come from the
/// protocol rather than from this project's conventions:
///
/// 1. SignalR control is event driven - OnControlRecived fires on change, one
///    channel at a time. The drive command has to be PERIODIC at 50 Hz because
///    the nodes' failsafe timer hangs on it, and it has to carry BOTH tracks in
///    ONE frame so they read the same bus instant. So the manager runs its own
///    send loop and the control channels only deposit values into shared state.
///
/// 2. Mixing throttle and steering into two track speeds happens here, not in
///    the browser's gamepad mapping. The mix has to stay consistent when only
///    one of the two inputs changes, and this is the only place that always
///    holds both.
///
/// Wire format in <see cref="CanTrackProtocol"/>; it mirrors the firmware and
/// the two have to be changed together.
/// </summary>
public class CanTrackDriveManager : IModuleManager, IDisposable
{
    private readonly ILogger<CanTrackDriveManager> _logger;

    // --- options, set by ModuleManagerFactory from the ChannelMap -----------

    /// <summary>SocketCAN interface. Use "vcan0" to exercise the protocol
    /// without hardware.</summary>
    public string Interface { get; set; } = "can0";

    /// <summary>Speed a full-scale control input asks for.</summary>
    public float MaxSpeedRadPerSecond { get; set; } = 20f;

    /// <summary>How much of full scale steering may take. 1.0 lets the vehicle
    /// turn on the spot at full stick: throttle 0 with full steering gives the
    /// two tracks +1 and -1.</summary>
    public float SteeringGain { get; set; } = 1.0f;

    /// <summary>
    /// Flips a track's direction of rotation.
    ///
    /// The two hub motors are mounted mirrored, one per side, and both run the
    /// same firmware calibration - so the same commanded sign turns both the
    /// same way in MOTOR coordinates, which drives the vehicle in a circle
    /// rather than straight. Exactly one of these two normally has to be set.
    ///
    /// Everything above this class stays in VEHICLE coordinates: positive
    /// means that track pushes the vehicle forward. The flip is applied when
    /// the command is encoded and undone when telemetry is decoded, so the
    /// reported speed of a track running forward is positive on both sides.
    ///
    /// Which one to set is a question for the first drive test, not for the
    /// schematic: a board whose phases happen to be swapped already turns the
    /// other way. Both default to false so nothing is assumed.
    /// </summary>
    public bool InvertLeft { get; set; }

    /// <inheritdoc cref="InvertLeft"/>
    public bool InvertRight { get; set; }

    /// <summary>Command period. The firmware's master timeout is 150 ms, i.e.
    /// three missed frames at the default 20 ms.</summary>
    public int CommandIntervalMs { get; set; } = 20;

    /// <summary>A node whose status is older than this counts as gone. Its
    /// status arrives at 20 Hz, so this is five missed frames.</summary>
    public int NodeTimeoutMs { get; set; } = 250;

    /// <summary>How many nodes have to be present before the drive is released.
    /// Set to 1 for single-board bench work.
    ///
    /// This check belongs here and nowhere else: the firmware only arms its peer
    /// watchdog after it has seen the peer at least once, otherwise a single
    /// board on the bench would latch a fault 200 ms after boot. A node that
    /// never appears is therefore invisible to the other node, and only the
    /// master knows how many there are supposed to be.
    ///
    /// It is a count, not a list of addresses: with 1, either board alone
    /// releases the drive.</summary>
    public int ExpectedNodes { get; set; } = 2;

    /// <summary>How long the fault-reset flag stays set after the button is
    /// pressed, so the nodes see it across several command frames.</summary>
    public int FaultResetHoldMs { get; set; } = 250;

    /// <summary>
    /// Switch the nodes to Brake or Coast (<see cref="BrakeAtStandstill"/>)
    /// once the tracks stand still and nothing asks them to move. Disable only
    /// to test the firmware's Stop.
    ///
    /// The reasoning below is the original one, for firmware before
    /// 2026-11-04. It no longer holds for current firmware, which is why the
    /// default is now Brake rather than Coast.
    ///
    /// The firmware's Stop keeps the driver on and regulates to zero speed,
    /// and at standstill that is unstable: the gate edges put roughly 85
    /// spurious Hall edges per second on the sensor lines, the velocity loop
    /// reads them as motion and answers with current, and the wheel ends up
    /// swinging back and forth at ±20 rad/s against the current limit until
    /// the DRV8301 latches. Recorded on the bench on 2026-11-02 with nothing
    /// on the bus but Stop frames.
    ///
    /// Nothing is lost by coasting there. Stop gives no holding torque at
    /// standstill anyway - the firmware empties the velocity integrator below
    /// 1 rad/s - so the only difference is whether the driver is running.
    /// Stop is still sent while the tracks are moving, because that is where
    /// it brakes.
    /// </summary>
    public bool CoastAtStandstill { get; set; } = true;

    /// <summary>
    /// What the standstill logic of <see cref="CoastAtStandstill"/> sends:
    /// Brake (true) or Coast (false).
    ///
    /// Firmware from 2026-11-04 on no longer needs the guard against the Stop
    /// oscillation - it reads the Hall sensors in step with the PWM, measures
    /// speed from edge timing and parks by itself in Stop. Coast now only
    /// costs: the gate driver goes into standby and the wheels turn freely,
    /// so a vehicle on a slope rolls away. Brake parks instead and shorts the
    /// windings below 2 rad/s, which brakes by back-EMF alone. Older firmware
    /// treats Brake like Velocity at zero, i.e. like Stop.
    /// </summary>
    public bool BrakeAtStandstill { get; set; } = true;

    private CanTrackProtocol.DriveMode StandstillMode => BrakeAtStandstill
        ? CanTrackProtocol.DriveMode.Brake
        : CanTrackProtocol.DriveMode.Coast;

    /// <summary>Below this reported speed a track counts as standing. Matches
    /// the firmware's own coast threshold; the Hall velocity is blind below
    /// it anyway.</summary>
    public float StandstillSpeedRadPerSecond { get; set; } = 1.0f;

    /// <summary>How long both tracks have to stand before the driver goes
    /// off. Four status frames, so one stale reading does not decide it.</summary>
    public int StandstillCoastMs { get; set; } = 200;

    /// <summary>
    /// Coast after this long at zero command even if the tracks still report
    /// motion. A real stop takes well under a second; a node still "moving"
    /// after two is the Stop oscillation itself, and the speed check alone
    /// would then hold the driver on forever.
    /// </summary>
    public int MaxStopMs { get; set; } = 2000;

    /// <summary>
    /// Shell command run when the controller goes bus-off. Empty disables it.
    ///
    /// Bus-off is not self-healing here. The kernel can recover an interface
    /// brought up with restart-ms, but **this adapter does not support it** -
    /// a Geschwister Schneider / candleLight unit refuses the option with
    /// "Device doesn't support restart from Bus Off". So after a bus-off the
    /// interface stays off the wire until someone cycles it, and on a vehicle
    /// that has driven away there is nobody to do that.
    ///
    /// Bringing a link up needs NET_ADMIN, which this process should not
    /// have. So the driver decides WHEN and the operator decides HOW: point
    /// this at a command that is permitted without a password, for example
    ///
    ///     sudo /usr/local/sbin/can-recover can0
    ///
    /// with a sudoers line for exactly that script and nothing else. Left
    /// empty the driver still detects and reports bus-off; it simply cannot
    /// act on it.
    /// </summary>
    public string BusOffRecoveryCommand { get; set; } = string.Empty;

    /// <summary>Shortest gap between recovery attempts. A bus that is
    /// physically broken would otherwise be cycled forever.</summary>
    public int BusOffRecoveryIntervalSeconds { get; set; } = 10;

    /// <summary>
    /// Stop if no control input has arrived for this long.
    ///
    /// The control path runs over a network, so it can fail in two ways and
    /// only one of them is obvious. A dropped connection eventually reaches
    /// ControlService.OnClosed, which releases every channel - but SignalR's
    /// ServerTimeout defaults to 30 seconds, and a vehicle holding its last
    /// commanded speed for half a minute is not acceptable. A link that is
    /// merely slow never triggers that path at all: the commands arrive, just
    /// late, which is arguably worse because nothing anywhere reports a fault.
    ///
    /// Both look identical from here - input stops being fresh - so one age
    /// check covers them. It is deliberately NOT built on the per-channel
    /// ResendRequiredContolDecorator: that is opt-in per channel, and with
    /// mixing a half-configured set is dangerous (throttle released while
    /// steering is held makes the vehicle spin on the spot). This check is
    /// always on and covers every drive input at once.
    ///
    /// Requires the client to resend, i.e. maxResendInterval set on the drive
    /// channels; the browser then repeats the last value at half that period.
    /// Keep this comfortably above that repeat period.
    /// </summary>
    public int ControlTimeoutMs { get; set; } = 500;

    /// <summary>
    /// Effective rolling radius of a track in metres: metres of travel per
    /// radian of motor rotation. Zero means not calibrated, and the odometry
    /// then reports only the quantities that do not need it.
    ///
    /// Measure it, do not derive it from the sprocket: drive at a known
    /// commanded speed towards a flat wall and divide the closing rate by the
    /// commanded rate. That captures the real rolling radius and the
    /// longitudinal slip in one number.
    /// </summary>
    public double WheelRadiusM { get; set; }

    /// <summary>
    /// Effective distance between the tracks in metres.
    ///
    /// Also measured, not taped: slip makes a tracked vehicle behave as though
    /// its tracks were 10 to 50 percent further apart than they are. Rotate on
    /// the spot at a known speed difference and divide by the observed yaw
    /// rate. Zero means not calibrated.
    /// </summary>
    public double TrackWidthM { get; set; }

    /// <summary>Where the flight recorder writes its dumps. Empty keeps the
    /// ring buffer but writes nothing.</summary>
    public string RecorderDirectory { get; set; } = string.Empty;

    /// <summary>How much history to keep. Long enough to cover the run-up to
    /// an incident, not so long that the interesting part scrolls past.</summary>
    public int RecorderSeconds { get; set; } = 60;

    /// <summary>Sampling rate of the recorder. The status frames arrive at
    /// 20 Hz, so there is nothing to gain above that.</summary>
    public int RecorderHz { get; set; } = 20;

    // --- state --------------------------------------------------------------

    private readonly object _stateLock = new();
    private readonly object _txLock = new();

    private RawCanSocket? _socket;
    private Thread? _rxThread;
    private Thread? _txThread;
    private volatile bool _running;
    private bool _started;
    private bool _disposed;

    private readonly NodeRecord[] _nodes =
    {
        new() { Node = CanTrackProtocol.LeftNode },
        new() { Node = CanTrackProtocol.RightNode },
    };

    private float _throttle;
    private float _steering;
    private float? _directLeft;
    private float? _directRight;
    private long _faultResetUntilTicks;
    private long _lastControlMs = -1; //!< -1 means nothing has ever arrived

    private long _odoLastMs = -1;
    private double _odoLeftRad, _odoRightRad;
    private double _odoX, _odoY, _odoHeading, _odoDistance;
    private double _odoSpeed, _odoYawRate;

    private double _commandedLeft;
    private double _commandedRight;
    private CanTrackProtocol.DriveMode _mode = CanTrackProtocol.DriveMode.Stop;
    private string? _inhibitReason = "not started";

    // Starts coasting: at boot nothing is moving, and a node that comes up
    // should never see the driver-on Stop first.
    private bool _coasting = true;
    private long _idleSinceMs = -1;
    private long _standingSinceMs = -1;

    private ushort _sequence;
    private long _framesSent;
    private long _framesReceived;
    private long _sendFailures;
    private long _unknownFrames;
    private long _ackErrors;
    private long _errorWarnings;
    private long _errorPassive;
    private long _busOffEvents;
    private long _controllerRestarts;
    private bool _busOff;
    private string _busState = "unknown";
    private string _busStateSource = "none";
    private long _txDropped;
    private long _txPackets;
    private TimeSpan _nextLinkPoll;

    private readonly Stopwatch _clock = Stopwatch.StartNew();

    private FlightRecorder? _recorder;
    private long _recorderLastMs;

    public CanTrackDriveManager(ILogger<CanTrackDriveManager> logger)
    {
        _logger = logger;
    }

    // --- IModuleManager ------------------------------------------------------

    /// <summary>Address selects the axis, see <see cref="TrackDriveAxis"/>.</summary>
    public T GetModule<T>(int address) where T : class, IModule
    {
        EnsureStarted();
        var axis = (TrackDriveAxis)address;
        if (!Enum.IsDefined(axis))
        {
            _logger.LogError("Unknown track drive axis {Address}; see TrackDriveAxis.", address);
            axis = TrackDriveAxis.Throttle;
        }

        if (new Input(this, axis) is not T module)
        {
            throw new InvalidCastException(
                $"CanTrackDriveManager provides ITrackDriveInput, not {typeof(T).Name}.");
        }
        return module;
    }

    // --- start up ------------------------------------------------------------

    /// <summary>
    /// Opened lazily rather than in the constructor: ModuleManagerFactory sets
    /// the options by property AFTER construction, so <see cref="Interface"/>
    /// is still at its default while the constructor runs.
    /// </summary>
    public void EnsureStarted()
    {
        lock (_stateLock)
        {
            if (_started || _disposed) return;
            _started = true;
        }

        _recorder = new FlightRecorder(_logger,
            Math.Max(1, RecorderSeconds) * Math.Max(1, RecorderHz))
        {
            Directory = RecorderDirectory,
        };

        _running = true;
        _rxThread = new Thread(ReceiveLoop) { IsBackground = true, Name = "can-track-rx" };
        _txThread = new Thread(TransmitLoop) { IsBackground = true, Name = "can-track-tx" };
        _rxThread.Start();
        _txThread.Start();
    }

    /// <summary>
    /// Opens the socket, or reopens it after a bus-off recovery. Returns
    /// false quietly when the interface is simply not there yet - that is a
    /// normal state at boot, not an error.
    /// </summary>
    private bool OpenSocket()
    {
        if (_socket != null) return true;
        try
        {
            var iface = CanNetworkInterface.GetAllInterfaces(true)
                .FirstOrDefault(i => string.Equals(i.Name, Interface, StringComparison.Ordinal));
            if (iface == null)
            {
                // Not found covers two cases that look identical from here:
                // the adapter is unplugged, or the interface exists but is
                // down and unconfigured. The second one happens without
                // anybody touching the hardware - a USB re-enumeration makes
                // the kernel re-probe gs_usb, which destroys the netdev and
                // builds a new one, and the bitrate and up state live on the
                // netdev, not on the adapter. Observed on the bench after the
                // laptop suspended: same USB device throughout, three
                // successive interface indices, can0 STOPPED each time.
                //
                // No error frame is produced by any of that, because there is
                // no controller left to produce one. Without this call the
                // driver would retry opening forever and never ask anyone to
                // bring the interface back.
                SetInhibitOnce($"CAN interface {Interface} not found or down");
                TryInterfaceRecovery("interface missing or down");
                return false;
            }

            var socket = new RawCanSocket();
            socket.Bind(iface);
            // Everything we care about is below 0x200; the mask keeps broadcast,
            // command echo and both nodes' telemetry and drops the rest in the
            // kernel rather than on the Pi's CPU.
            socket.CanFilters = new[] { new CanFilter(0x000, 0x600) };
            // Error frames as well. Without these the driver cannot tell an
            // empty bus from a broken one: both simply produce no telemetry.
            // Measured on real hardware with no second node - the interface
            // walks from error-active to error-passive and the driver saw
            // nothing at all.
            socket.ErrorFilters = CanErrorClass.CAN_ERR_TX_TIMEOUT
                                | CanErrorClass.CAN_ERR_LOSTARB
                                | CanErrorClass.CAN_ERR_CRTL
                                | CanErrorClass.CAN_ERR_PROT
                                | CanErrorClass.CAN_ERR_TRX
                                | CanErrorClass.CAN_ERR_ACK
                                | CanErrorClass.CAN_ERR_BUSOFF
                                | CanErrorClass.CAN_ERR_BUSERROR
                                | CanErrorClass.CAN_ERR_RESTARTED;
            socket.ReceiveTimeout = 200;
            _socket = socket;
            lock (_stateLock) { _busOff = false; _busState = "unknown"; _openProblem = null; }
            _nextLinkPoll = TimeSpan.Zero;

            _logger.LogInformation(
                "CAN track drive up on {Interface}, command every {Interval} ms, expecting {Nodes} node(s).",
                Interface, CommandIntervalMs, ExpectedNodes);
            return true;
        }
        catch (Exception ex)
        {
            SetInhibitOnce($"CAN open failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Asks the kernel what the controller is doing, once a second.
    /// <para>
    /// This exists because error frames are not universally available.  On the
    /// candleLight/gs_usb adapter used here they never arrive at all: a raw
    /// socket with every error class enabled received none, and the same
    /// adapter rejects both <c>berr-reporting</c> and restart-from-bus-off.
    /// The netlink counters it does keep moved regardless, so this is the only
    /// working view of the wire on that hardware.  Where error frames do work
    /// they are still the faster path and keep running; this poll only
    /// corrects the figures behind them.
    /// </para>
    /// </summary>
    private void PollLinkState()
    {
        if (_clock.Elapsed < _nextLinkPoll) return;
        _nextLinkPoll = _clock.Elapsed + TimeSpan.FromSeconds(1);
        var needRecovery = false;

        try
        {
            var iface = CanNetworkInterface.GetAllInterfaces(true)
                .FirstOrDefault(i => string.Equals(i.Name, Interface, StringComparison.Ordinal));
            if (iface == null) return;

            var link = iface.LinkStatistics;
            var dev = iface.IsVirtual ? null : iface.DeviceStatistics;
            var state = iface.IsVirtual ? null : iface.CanControllerState;

            lock (_stateLock)
            {
                _txDropped = (long)link.TxDropped;
                _txPackets = (long)link.TxPackets;

                if (dev != null)
                {
                    // Absolute counters since the interface came up, so assign
                    // rather than add - unlike the error-frame path, which only
                    // ever sees increments.
                    _errorWarnings = (long)dev.ErrorWarning;
                    _errorPassive = (long)dev.ErrorPassive;
                    _busOffEvents = (long)dev.BusOff;
                    _controllerRestarts = (long)dev.Restarts;
                }

                if (state != null)
                {
                    _busState = state switch
                    {
                        CanState.CAN_STATE_ERROR_ACTIVE => "error-active",
                        CanState.CAN_STATE_ERROR_WARNING => "error-warning",
                        CanState.CAN_STATE_ERROR_PASSIVE => "error-passive",
                        CanState.CAN_STATE_BUS_OFF => "bus-off",
                        CanState.CAN_STATE_STOPPED => "stopped",
                        CanState.CAN_STATE_SLEEPING => "sleeping",
                        _ => "unknown",
                    };
                    _busStateSource = "netlink";
                    _busOff = state == CanState.CAN_STATE_BUS_OFF
                           || state == CanState.CAN_STATE_STOPPED;
                    needRecovery = _busOff;
                }
            }
        }
        catch (Exception)
        {
            // vcan has no controller, a removed adapter has no interface.
            // Neither is worth a log line every second.
        }

        // Outside the lock: the recovery runs a process and is rate limited
        // on its own.
        if (needRecovery) TryInterfaceRecovery($"bus {_busState}");
    }

    private void SetInhibit(string? reason)
    {
        lock (_stateLock)
        {
            _inhibitReason = reason;
        }
    }

    // --- inputs --------------------------------------------------------------

    private sealed class Input : ITrackDriveInput
    {
        private readonly CanTrackDriveManager _owner;
        private readonly TrackDriveAxis _axis;

        public Input(CanTrackDriveManager owner, TrackDriveAxis axis)
        {
            _owner = owner;
            _axis = axis;
        }

        public void SetValue(float value) => _owner.SetAxis(_axis, value);
        public void Release() => _owner.ReleaseAxis(_axis);
        public override string ToString() => $"TrackDrive[{_axis}]";
    }

    private static float Clamp(float v) => v < -1f ? -1f : v > 1f ? 1f : v;

    internal void SetAxis(TrackDriveAxis axis, float value)
    {
        switch (axis)
        {
            case TrackDriveAxis.Throttle:
            case TrackDriveAxis.Steering:
            case TrackDriveAxis.Left:
            case TrackDriveAxis.Right:
                lock (_stateLock) { _lastControlMs = _clock.ElapsedMilliseconds; }
                break;
        }

        switch (axis)
        {
            case TrackDriveAxis.Throttle:
                lock (_stateLock) { _throttle = Clamp(value); _directLeft = null; _directRight = null; }
                break;
            case TrackDriveAxis.Steering:
                lock (_stateLock) { _steering = Clamp(value); _directLeft = null; _directRight = null; }
                break;
            case TrackDriveAxis.Left:
                lock (_stateLock) { _directLeft = Clamp(value); }
                break;
            case TrackDriveAxis.Right:
                lock (_stateLock) { _directRight = Clamp(value); }
                break;
            case TrackDriveAxis.FaultReset:
                if (MathF.Abs(value) >= 0.5f) RequestFaultReset();
                break;
            case TrackDriveAxis.EmergencyStop:
                if (MathF.Abs(value) >= 0.5f) BroadcastEmergencyStop();
                break;
            case TrackDriveAxis.OdometryReset:
                if (MathF.Abs(value) >= 0.5f) ResetOdometry();
                break;
            case TrackDriveAxis.RecordDump:
                if (MathF.Abs(value) >= 0.5f) DumpRecording("manual");
                break;
        }
    }

    /// <summary>
    /// Releasing ANY drive input zeroes them all.
    ///
    /// Mixing makes partial release dangerous: zero throttle with steering
    /// still held is not "stopped", it is "turning on the spot". Channels are
    /// released independently - by ControlService on disconnect, or by a
    /// per-channel resend timeout - so a partial release is a normal event,
    /// not an exotic one.
    /// </summary>
    internal void ReleaseAxis(TrackDriveAxis axis)
    {
        switch (axis)
        {
            case TrackDriveAxis.Throttle:
            case TrackDriveAxis.Steering:
            case TrackDriveAxis.Left:
            case TrackDriveAxis.Right:
                lock (_stateLock)
                {
                    _throttle = 0f;
                    _steering = 0f;
                    _directLeft = _directLeft.HasValue ? 0f : null;
                    _directRight = _directRight.HasValue ? 0f : null;
                }
                break;
        }
    }

    public void ResetOdometry()
    {
        lock (_stateLock)
        {
            _odoLeftRad = _odoRightRad = 0.0;
            _odoX = _odoY = _odoHeading = _odoDistance = 0.0;
        }
        _logger.LogInformation("Odometry reset.");
    }

    /// <summary>
    /// Differential drive kinematics. Separate and pure because this is where
    /// the sign conventions live, and a sign error here is invisible until the
    /// vehicle drives the wrong way.
    ///
    /// Positive yaw is a LEFT turn, the usual right-handed convention. Note
    /// that positive STEERING speeds the left track up and therefore turns
    /// right, so the two signs are opposite by design.
    /// </summary>
    public static (double speed, double yawRate) Kinematics(
        double leftRadPerSec, double rightRadPerSec, double wheelRadiusM, double trackWidthM)
    {
        if (wheelRadiusM <= 0.0 || trackWidthM <= 0.0) return (0.0, 0.0);
        var vl = leftRadPerSec * wheelRadiusM;
        var vr = rightRadPerSec * wheelRadiusM;
        return (0.5 * (vl + vr), (vr - vl) / trackWidthM);
    }

    /// <summary>
    /// Integrates the two reported track speeds. Must be called under
    /// _stateLock, from the command loop, so it shares the loop's cadence and
    /// the node states it reads are from one instant.
    /// </summary>
    private void UpdateOdometry(long nowMs)
    {
        if (_odoLastMs < 0) { _odoLastMs = nowMs; return; }
        var dt = (nowMs - _odoLastMs) / 1000.0;
        _odoLastMs = nowMs;
        if (dt <= 0.0 || dt > 1.0) return; // first pass, or a stall worth skipping

        // Vehicle coordinates already: the per-track inversion was undone when
        // the status frames were decoded, so positive is forward on both sides.
        var wl = _nodes[CanTrackProtocol.LeftNode].Speed;
        var wr = _nodes[CanTrackProtocol.RightNode].Speed;

        _odoLeftRad += wl * dt;
        _odoRightRad += wr * dt;

        if (WheelRadiusM <= 0.0 || TrackWidthM <= 0.0) return;

        var (v, omega) = Kinematics(wl, wr, WheelRadiusM, TrackWidthM);
        _odoSpeed = v;
        _odoYawRate = omega;

        // Exact arc rather than a straight step. At 20 rad/s differential the
        // vehicle can turn on the spot, and a Euler step would place the pose
        // outside the arc by a visible margin every tick.
        var h0 = _odoHeading;
        var h1 = h0 + omega * dt;
        if (Math.Abs(omega) < 1e-6)
        {
            _odoX += v * Math.Cos(h0) * dt;
            _odoY += v * Math.Sin(h0) * dt;
        }
        else
        {
            var r = v / omega;
            _odoX += r * (Math.Sin(h1) - Math.Sin(h0));
            _odoY -= r * (Math.Cos(h1) - Math.Cos(h0));
        }
        _odoHeading = h1;

        // Path length, so it keeps growing when the vehicle drives in circles.
        _odoDistance += Math.Abs(v) * dt;

        // Keep the heading in (-pi, pi] so it does not drift to a value that
        // loses precision after a long run.
        if (_odoHeading > Math.PI) _odoHeading -= 2.0 * Math.PI;
        else if (_odoHeading <= -Math.PI) _odoHeading += 2.0 * Math.PI;
    }

    public void RequestFaultReset()
    {
        lock (_stateLock)
        {
            _faultResetUntilTicks = _clock.ElapsedMilliseconds + FaultResetHoldMs;
        }
        _logger.LogInformation("Fault reset requested; flag set for {Hold} ms.", FaultResetHoldMs);
    }

    /// <summary>
    /// Broadcasts a stop to every node. Sender id 0xFF marks the master, which
    /// matters because a node discards a broadcast carrying its own id.
    /// </summary>
    public void BroadcastEmergencyStop()
    {
        _logger.LogWarning("Broadcasting emergency stop.");
        Send(CanTrackProtocol.EmergencyStopId,
             new byte[] { (byte)CanTrackProtocol.FaultCode.EmergencyStop, 0xFF });
    }

    // --- mixing --------------------------------------------------------------

    /// <summary>
    /// Tank mixing. Scaled down rather than clipped when the sum overflows:
    /// clipping the inside track alone would change the turn radius exactly
    /// when the stick is pushed hardest, which is the worst moment for the
    /// vehicle to behave differently than it did a moment earlier.
    /// </summary>
    public static (double left, double right) Mix(double throttle, double steering, double steeringGain)
    {
        var left = throttle + steering * steeringGain;
        var right = throttle - steering * steeringGain;
        var peak = Math.Max(Math.Abs(left), Math.Abs(right));
        if (peak > 1.0)
        {
            left /= peak;
            right /= peak;
        }
        return (left, right);
    }

    // --- transmit ------------------------------------------------------------

    private void TransmitLoop()
    {
        var next = _clock.Elapsed;
        var period = TimeSpan.FromMilliseconds(Math.Max(1, CommandIntervalMs));

        while (_running)
        {
            try
            {
                PollLinkState();
                SendCommandFrame();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Track drive command frame failed.");
            }

            next += period;
            var wait = next - _clock.Elapsed;
            if (wait > TimeSpan.Zero)
            {
                Thread.Sleep(wait);
            }
            else if (wait < -period)
            {
                // The Pi stalled, most likely behind a video encode burst. Do
                // not try to catch up by sending a burst of stale commands.
                next = _clock.Elapsed;
            }
        }
    }

    private void SendCommandFrame()
    {
        double left, right;
        CanTrackProtocol.DriveMode mode;
        bool clearFault;
        ushort sequence;

        lock (_stateLock)
        {
            var now = _clock.ElapsedMilliseconds;
            UpdateOdometry(now);
            RefreshPresence(now);

            if (_inhibitReason != null)
            {
                left = right = 0.0;
                mode = CanTrackProtocol.DriveMode.Stop;
            }
            else if (_directLeft.HasValue || _directRight.HasValue)
            {
                left = _directLeft ?? 0f;
                right = _directRight ?? 0f;
                mode = CanTrackProtocol.DriveMode.Velocity;
            }
            else
            {
                (left, right) = Mix(_throttle, _steering, SteeringGain);
                mode = CanTrackProtocol.DriveMode.Velocity;
            }

            _commandedLeft = left * MaxSpeedRadPerSecond;
            _commandedRight = right * MaxSpeedRadPerSecond;
            mode = ApplyStandstillCoast(mode, now);
            _mode = mode;
            clearFault = now < _faultResetUntilTicks;
            sequence = unchecked(++_sequence);
        }

        RecordSample();

        // _commandedLeft/_commandedRight stay in vehicle coordinates for the UI;
        // only the wire carries motor coordinates.
        var wireLeft = InvertLeft ? -_commandedLeft : _commandedLeft;
        var wireRight = InvertRight ? -_commandedRight : _commandedRight;

        var data = new byte[8];
        CanTrackProtocol.WriteInt16(data, 0, CanTrackProtocol.ToWire(wireLeft * 100.0));
        CanTrackProtocol.WriteInt16(data, 2, CanTrackProtocol.ToWire(wireRight * 100.0));
        data[4] = (byte)mode;
        data[5] = clearFault ? CanTrackProtocol.CommandFlagClearFault : (byte)0;
        CanTrackProtocol.WriteUInt16(data, 6, sequence);

        Send(CanTrackProtocol.CommandId, data);
    }

    /// <summary>
    /// Takes one sample for the flight recorder, decimated to RecorderHz. In
    /// memory only - the file is written from a worker when something trips.
    /// </summary>
    private void RecordSample()
    {
        var recorder = _recorder;
        if (recorder == null) return;
        var period = 1000 / Math.Max(1, RecorderHz);
        long now;
        FlightRecorder.Sample sample;
        lock (_stateLock)
        {
            now = _clock.ElapsedMilliseconds;
            if (now - _recorderLastMs < period) return;
            _recorderLastMs = now;

            var l = _nodes[CanTrackProtocol.LeftNode];
            var r = _nodes[CanTrackProtocol.RightNode];
            sample = new FlightRecorder.Sample(
                now / 1000.0,
                (float)l.Speed, (float)l.Target, (float)l.CurrentQ,
                (float)(l.Temperature ?? double.NaN), (float)l.ThermalUtilisation,
                (byte)l.State, (byte)l.Flags, (byte)l.Fault,
                (float)r.Speed, (float)r.Target, (float)r.CurrentQ,
                (float)(r.Temperature ?? double.NaN), (float)r.ThermalUtilisation,
                (byte)r.State, (byte)r.Flags, (byte)r.Fault,
                (float)l.BusVolts, (float)l.BusAmps,
                (float)l.CurrentD, (float)r.CurrentD,
                (byte)l.HallErrorPercent, (byte)r.HallErrorPercent,
                (float)_commandedLeft, (float)_commandedRight, (byte)_mode,
                _lastControlMs < 0 ? float.PositiveInfinity : (now - _lastControlMs) / 1000f,
                (byte)(_inhibitReason == null ? 1 : 0), _inhibitReason);
        }
        recorder.Add(sample);
    }

    /// <summary>
    /// Writes the buffer out, off the command and receive loops because it
    /// touches the file system. A vehicle must not stutter because a log is
    /// being flushed.
    /// </summary>
    public void DumpRecording(string reason)
    {
        var recorder = _recorder;
        if (recorder == null) return;
        Task.Run(() => recorder.Dump(reason));
    }

    /// <summary>
    /// Decides whether the drive may move. Must be called under _stateLock.
    /// </summary>
    private void RefreshPresence(long nowMs)
    {
        if (_socket == null)
        {
            _inhibitReason = "CAN not open";
            return;
        }

        if (_busOff)
        {
            _inhibitReason = "CAN bus-off";
            return;
        }

        var present = CountPresent(nowMs);
        string? faulted = null;
        for (var i = 0; i < _nodes.Length; i++)
        {
            var n = _nodes[i];
            if (n.Fault != CanTrackProtocol.FaultCode.None)
            {
                faulted ??= $"node {i} faulted: {CanTrackProtocol.Describe(n.Fault)}";
            }
        }

        if (present < ExpectedNodes)
        {
            _inhibitReason = $"only {present} of {ExpectedNodes} nodes present";
            return;
        }
        if (faulted != null)
        {
            _inhibitReason = faulted;
            return;
        }

        // The network link, checked by the age of the newest input rather than
        // by any connection state: a slow link and a dead one look the same
        // from here, and only one of them ever raises an event.
        if (_lastControlMs < 0)
        {
            _inhibitReason = "no control input yet";
            return;
        }
        var age = nowMs - _lastControlMs;
        if (age > ControlTimeoutMs)
        {
            _inhibitReason = $"control input stale ({age} ms)";
            return;
        }

        _inhibitReason = null;
    }

    /// <summary>
    /// Replaces the mode with Brake or Coast (<see cref="BrakeAtStandstill"/>)
    /// once nothing is commanded and the tracks stand, see
    /// <see cref="CoastAtStandstill"/>. Latches until a nonzero
    /// command arrives, so a track nudged by hand does not switch the driver
    /// back on. Must be called under _stateLock, after the commanded speeds
    /// are set.
    /// </summary>
    private CanTrackProtocol.DriveMode ApplyStandstillCoast(CanTrackProtocol.DriveMode mode, long nowMs)
    {
        const double idleEps = 0.05; // rad/s, the firmware's COAST_TARGET_EPS
        if (Math.Abs(_commandedLeft) > idleEps || Math.Abs(_commandedRight) > idleEps)
        {
            _coasting = false;
            _idleSinceMs = _standingSinceMs = -1;
            return mode;
        }
        if (!CoastAtStandstill) return mode;
        if (_coasting) return StandstillMode;

        if (_idleSinceMs < 0) _idleSinceMs = nowMs;

        // Only nodes that are reporting have a speed worth looking at; one
        // that is gone has nothing to brake either.
        var standing = _nodes.All(n => !(n.Seen && nowMs - n.LastSeenMs <= NodeTimeoutMs)
                                       || Math.Abs(n.Speed) < StandstillSpeedRadPerSecond);
        if (!standing) _standingSinceMs = -1;
        else if (_standingSinceMs < 0) _standingSinceMs = nowMs;

        _coasting = (_standingSinceMs >= 0 && nowMs - _standingSinceMs >= StandstillCoastMs)
                    || nowMs - _idleSinceMs >= MaxStopMs;
        return _coasting ? StandstillMode : mode;
    }

    /// <summary>
    /// Counts every node that has reported recently, whichever address it has.
    /// A single bench board may be either side - taking only the first
    /// ExpectedNodes slots would leave a lone right node uncounted and the
    /// drive inhibited forever. Must be called under _stateLock.
    /// </summary>
    private int CountPresent(long nowMs)
        => _nodes.Count(n => n.Seen && nowMs - n.LastSeenMs <= NodeTimeoutMs);

    private void Send(uint id, byte[] data)
    {
        var socket = _socket;
        if (socket == null) return;
        try
        {
            lock (_txLock)
            {
                socket.Write(new CanFrame(id, data));
            }
            Interlocked.Increment(ref _framesSent);
        }
        catch (Exception ex)
        {
            var failures = Interlocked.Increment(ref _sendFailures);
            // A bus nobody acknowledges fails on every frame; log the first few
            // and then stay quiet rather than filling the journal at 50 Hz.
            if (failures <= 5 || failures % 500 == 0)
            {
                _logger.LogWarning(ex,
                    "CAN write failed ({Count} total, bus {State}, {Sent} frames out, " +
                    "{Dropped} dropped). ENOBUFS with nothing sent means no other node " +
                    "is acknowledging on {Interface}: the controller retries the first " +
                    "frame forever and the queue never drains.",
                    failures, _busState, _txPackets, _txDropped, Interface);
            }
        }
    }

    // --- receive -------------------------------------------------------------

    private void ReceiveLoop()
    {
        while (_running)
        {
            if (!OpenSocket())
            {
                // The interface may not exist yet - udev settles after boot
                // and the adapter can be plugged in later - or it may be
                // between a bus-off and its recovery. Either way, keep trying.
                Thread.Sleep(1000);
                continue;
            }

            try
            {
                var socket = _socket;
                if (socket == null) continue;
                if (socket.Read(out CanFrame frame) <= 0) continue;
                Dispatch(frame);
            }
            catch (Exception) when (!_running)
            {
                break; // socket closed during shutdown
            }
            catch (Exception)
            {
                // Receive timeout is the normal case on a quiet bus. Anything
                // else shows up as missing telemetry, which the UI already sees.
            }
        }
        CloseSocket();
    }

    private void CloseSocket()
    {
        var socket = _socket;
        _socket = null;
        try { socket?.Close(); } catch { /* going away anyway */ }
        socket?.Dispose();
    }

    private string? _openProblem;

    /// <summary>Inhibits with a reason, logging it only when it changes - the
    /// receive loop retries every second and would otherwise fill the
    /// journal with the same line.</summary>
    private void SetInhibitOnce(string reason)
    {
        bool changed;
        lock (_stateLock)
        {
            changed = _openProblem != reason;
            _openProblem = reason;
            _inhibitReason = reason;
        }
        if (changed) _logger.LogWarning("{Reason}", reason);
    }

    private void Dispatch(CanFrame frame)
    {
        const uint effFlag = 0x80000000u;
        const uint rtrFlag = 0x40000000u;
        const uint errFlag = 0x20000000u;

        if ((frame.CanId & errFlag) != 0)
        {
            ApplyErrorFrame(frame);
            return;
        }
        if ((frame.CanId & (effFlag | rtrFlag)) != 0) return;
        var id = frame.CanId & 0x7FFu;
        var data = frame.Data;
        var len = frame.Length;

        Interlocked.Increment(ref _framesReceived);

        for (var node = 0; node < _nodes.Length; node++)
        {
            if (id == CanTrackProtocol.StatusId(node)) { ApplyStatus(node, data, len); return; }
            if (id == CanTrackProtocol.PowerId(node)) { ApplyPower(node, data, len); return; }
            if (id == CanTrackProtocol.FaultId(node)) { ApplyFault(node, data, len); return; }
            if (id == CanTrackProtocol.DiagId(node)) { ApplyDiag(node, data, len); return; }
        }

        if (id == CanTrackProtocol.EmergencyStopId)
        {
            if (len >= 2)
            {
                _logger.LogWarning("Emergency stop on the bus: {Fault} from node {Node}.",
                    CanTrackProtocol.Describe((CanTrackProtocol.FaultCode)data[0]), data[1]);
            }
            return;
        }

        if (id == CanTrackProtocol.CommandId) return; // our own frame, looped back
        Interlocked.Increment(ref _unknownFrames);
    }

    private bool IsInverted(int node) =>
        node == CanTrackProtocol.LeftNode ? InvertLeft : InvertRight;

    /// <summary>
    /// Decodes a kernel error frame. The class lives in the identifier, the
    /// controller's own state in data[1].
    /// </summary>
    private void ApplyErrorFrame(CanFrame frame)
    {
        var cls = (CanErrorClass)(frame.CanId & 0x1FFFFFFFu);
        var ctrl = frame.Length > 1 ? (CanControllerErrorStatus)frame.Data[1]
                                    : CanControllerErrorStatus.CAN_ERR_CRTL_UNSPEC;

        lock (_stateLock)
        {
            _busStateSource = "error-frames";
            if ((cls & CanErrorClass.CAN_ERR_ACK) != 0) _ackErrors++;

            if ((cls & CanErrorClass.CAN_ERR_BUSOFF) != 0)
            {
                _busOffEvents++;
                _busOff = true;
                _busState = "bus-off";
            }
            else if ((cls & CanErrorClass.CAN_ERR_RESTARTED) != 0)
            {
                _controllerRestarts++;
                _busOff = false;
                _busState = "restarted";
            }
            else if ((cls & CanErrorClass.CAN_ERR_CRTL) != 0)
            {
                if ((ctrl & (CanControllerErrorStatus.CAN_ERR_CRTL_TX_PASSIVE
                           | CanControllerErrorStatus.CAN_ERR_CRTL_RX_PASSIVE)) != 0)
                {
                    _errorPassive++;
                    _busState = "error-passive";
                }
                else if ((ctrl & (CanControllerErrorStatus.CAN_ERR_CRTL_TX_WARNING
                                | CanControllerErrorStatus.CAN_ERR_CRTL_RX_WARNING)) != 0)
                {
                    _errorWarnings++;
                    _busState = "error-warning";
                }
                else if ((ctrl & CanControllerErrorStatus.CAN_ERR_CRTL_ACTIVE) != 0)
                {
                    _busOff = false;
                    _busState = "error-active";
                }
            }
        }

        // Bus-off is the one worth acting on: unlike the warning states it
        // does not clear itself, and on this adapter neither the kernel nor
        // the device will bring the interface back.
        if ((cls & CanErrorClass.CAN_ERR_BUSOFF) != 0)
        {
            _logger.LogError(
                "CAN bus-off on {Interface}. The controller has left the bus and nothing " +
                "will put it back by itself - this adapter supports neither restart-ms nor " +
                "berr-reporting. Check termination and that something else is on the wire.",
                Interface);
            TryInterfaceRecovery("bus-off");
        }
    }

    private DateTime _lastRecoveryUtc = DateTime.MinValue;

    /// <summary>
    /// Runs the operator's recovery command, if one was configured. Fired
    /// from the receive thread, so the command must return promptly - it is
    /// meant to be an "ip link down, up", not a diagnosis.
    /// </summary>
    private void TryInterfaceRecovery(string reason)
    {
        var command = BusOffRecoveryCommand;
        if (string.IsNullOrWhiteSpace(command)) return;
        if ((DateTime.UtcNow - _lastRecoveryUtc).TotalSeconds < BusOffRecoveryIntervalSeconds) return;
        _lastRecoveryUtc = DateTime.UtcNow;

        _logger.LogWarning("Running CAN recovery ({Reason}): {Command}", reason, command);
        Task.Run(() =>
        {
            try
            {
                using var p = System.Diagnostics.Process.Start(
                    new System.Diagnostics.ProcessStartInfo("/bin/sh", $"-c \"{command}\"")
                    {
                        RedirectStandardError = true,
                        RedirectStandardOutput = true,
                    });
                if (p == null) return;
                p.WaitForExit(10000);
                var err = p.StandardError.ReadToEnd().Trim();
                if (p.ExitCode != 0)
                {
                    _logger.LogError("CAN recovery command exited {Code}: {Error}", p.ExitCode, err);
                    return;
                }
                _logger.LogWarning("CAN recovery command finished. Reopening {Interface}.", Interface);
                lock (_stateLock) { _busOff = false; _busState = "recovering"; }
                // The socket is bound to an interface that has just been
                // cycled, so it has to be rebuilt. Dropping it makes the
                // receive loop reopen on its next pass.
                CloseSocket();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "CAN recovery command failed.");
            }
        });
    }

    private void ApplyStatus(int node, byte[] d, int len)
    {
        if (len < 8) return;
        // Back into vehicle coordinates, so a track driving the vehicle forward
        // reports a positive speed whichever side it is on.
        var sign = IsInverted(node) ? -1.0 : 1.0;
        lock (_stateLock)
        {
            var n = _nodes[node];
            n.Seen = true;
            n.LastSeenMs = _clock.ElapsedMilliseconds;
            n.Speed = sign * CanTrackProtocol.ReadInt16(d, 0) / 100.0;
            n.Target = sign * CanTrackProtocol.ReadInt16(d, 2) / 100.0;
            n.State = (CanTrackProtocol.NodeState)d[4];
            n.Flags = (CanTrackProtocol.StatusFlags)d[5];
            n.CurrentQ = CanTrackProtocol.ReadInt16(d, 6) / 100.0;
        }
    }

    private void ApplyPower(int node, byte[] d, int len)
    {
        if (len < 8) return;
        lock (_stateLock)
        {
            var n = _nodes[node];
            n.BusVolts = CanTrackProtocol.ReadUInt16(d, 0) / 100.0;
            n.BusAmps = CanTrackProtocol.ReadInt16(d, 2) / 100.0;
            n.Watts = CanTrackProtocol.ReadInt16(d, 4) / 10.0;
            var t = (sbyte)d[6];
            n.Temperature = t == CanTrackProtocol.TemperatureInvalid ? null : t;
            n.ThermalUtilisation = d[7] / 100.0;
        }
    }

    private void ApplyDiag(int node, byte[] d, int len)
    {
        if (len < 8) return;
        var sign = IsInverted(node) ? -1.0 : 1.0;
        lock (_stateLock)
        {
            var n = _nodes[node];
            n.CurrentD = CanTrackProtocol.ReadInt16(d, 0) / 100.0;
            n.VoltageQ = sign * CanTrackProtocol.ReadInt16(d, 2) / 100.0;
            n.HallErrorPercent = d[4];
            n.IsrMaxUs = d[5];
            n.CurrentLimit = d[6] / 10.0;
            n.DebounceSamples = d[7];
        }
    }

    private void ApplyFault(int node, byte[] d, int len)
    {
        if (len < 6) return;
        CanTrackProtocol.FaultCode previous, current;
        lock (_stateLock)
        {
            var n = _nodes[node];
            previous = n.Fault;
            current = (CanTrackProtocol.FaultCode)d[0];
            n.Fault = current;
            n.FaultUptime = TimeSpan.FromMilliseconds(CanTrackProtocol.ReadUInt32(d, 2));
        }

        if (previous == current) return;
        if (current == CanTrackProtocol.FaultCode.None)
        {
            _logger.LogInformation("Node {Node} fault cleared.", node);
            return;
        }

        _logger.LogError("Node {Node} faulted: {Fault}.", node, CanTrackProtocol.Describe(current));
        // The run-up is what explains the fault, and it is already in the ring.
        DumpRecording($"node{node}-{CanTrackProtocol.Describe(current)}");
    }

    // --- snapshot ------------------------------------------------------------

    public TrackDriveSnapshot GetSnapshot()
    {
        EnsureStarted();
        lock (_stateLock)
        {
            var now = _clock.ElapsedMilliseconds;
            RefreshPresence(now);
            var present = CountPresent(now);
            return new TrackDriveSnapshot
            {
                Left = _nodes[CanTrackProtocol.LeftNode].ToState(now),
                Right = _nodes[CanTrackProtocol.RightNode].ToState(now),
                BusUp = _socket != null,
                AllNodesPresent = present >= ExpectedNodes,
                DriveEnabled = _inhibitReason == null,
                InhibitReason = _inhibitReason,
                ControlAgeSeconds = _lastControlMs < 0
                    ? double.PositiveInfinity : (now - _lastControlMs) / 1000.0,
                CommandedLeft = _commandedLeft,
                CommandedRight = _commandedRight,
                Mode = _mode,
                FramesSent = Interlocked.Read(ref _framesSent),
                FramesReceived = Interlocked.Read(ref _framesReceived),
                SendFailures = Interlocked.Read(ref _sendFailures),
                UnknownFrames = Interlocked.Read(ref _unknownFrames),
                BusState = _busState,
                AckErrors = _ackErrors,
                ErrorWarnings = _errorWarnings,
                ErrorPassive = _errorPassive,
                BusOffEvents = _busOffEvents,
                ControllerRestarts = _controllerRestarts,
                BusOff = _busOff,
                TxDropped = _txDropped,
                TxPackets = _txPackets,
                BusStateSource = _busStateSource,
                Odometry = new TrackOdometry
                {
                    Calibrated = WheelRadiusM > 0.0 && TrackWidthM > 0.0,
                    LeftTravelRad = _odoLeftRad,
                    RightTravelRad = _odoRightRad,
                    TravelDifferenceRad = _odoRightRad - _odoLeftRad,
                    SpeedMetersPerSecond = _odoSpeed,
                    YawRateRadPerSecond = _odoYawRate,
                    X = _odoX,
                    Y = _odoY,
                    HeadingRad = _odoHeading,
                    DistanceMeters = _odoDistance,
                },
            };
        }
    }

    private sealed class NodeRecord
    {
        public int Node;
        public bool Seen;
        public long LastSeenMs;
        public double Speed;
        public double Target;
        public CanTrackProtocol.NodeState State;
        public CanTrackProtocol.StatusFlags Flags;
        public double CurrentQ;
        public double BusVolts;
        public double BusAmps;
        public double Watts;
        public double? Temperature;
        public double ThermalUtilisation;
        public CanTrackProtocol.FaultCode Fault;
        public TimeSpan FaultUptime;
        public double CurrentD;
        public double VoltageQ;
        public int HallErrorPercent;
        public int IsrMaxUs;
        public double CurrentLimit;
        public int DebounceSamples;

        public TrackNodeState ToState(long nowMs) => new()
        {
            Node = Node,
            Seen = Seen,
            AgeSeconds = Seen ? (nowMs - LastSeenMs) / 1000.0 : double.PositiveInfinity,
            SpeedRadPerSecond = Speed,
            TargetRadPerSecond = Target,
            State = State,
            Flags = Flags,
            CurrentQAmps = CurrentQ,
            BusVolts = BusVolts,
            BusAmps = BusAmps,
            PowerWatts = Watts,
            TemperatureCelsius = Temperature,
            ThermalUtilisation = ThermalUtilisation,
            Fault = Fault,
            FaultUptime = FaultUptime,
            CurrentDAmps = CurrentD,
            VoltageQVolts = VoltageQ,
            HallErrorPercent = HallErrorPercent,
            IsrMaxMicroseconds = IsrMaxUs,
            CurrentLimitAmps = CurrentLimit,
            DebounceSamples = DebounceSamples,
        };
    }

    public void Dispose()
    {
        lock (_stateLock)
        {
            if (_disposed) return;
            _disposed = true;
        }
        _running = false;
        try { _socket?.Close(); } catch { /* shutting down */ }
        _txThread?.Join(500);
        _rxThread?.Join(500);
        _socket?.Dispose();
        _socket = null;
        GC.SuppressFinalize(this);
    }
}
