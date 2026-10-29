using System.Diagnostics;
using Microsoft.Extensions.Logging;
using SocketCANSharp;
using SocketCANSharp.Network;

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
    /// turn on the spot at full stick.</summary>
    public float SteeringGain { get; set; } = 1.0f;

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
    /// master knows how many there are supposed to be.</summary>
    public int ExpectedNodes { get; set; } = 2;

    /// <summary>How long the fault-reset flag stays set after the button is
    /// pressed, so the nodes see it across several command frames.</summary>
    public int FaultResetHoldMs { get; set; } = 250;

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

    private double _commandedLeft;
    private double _commandedRight;
    private CanTrackProtocol.DriveMode _mode = CanTrackProtocol.DriveMode.Stop;
    private string? _inhibitReason = "not started";

    private ushort _sequence;
    private long _framesSent;
    private long _framesReceived;
    private long _sendFailures;
    private long _unknownFrames;

    private readonly Stopwatch _clock = Stopwatch.StartNew();

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

        try
        {
            var iface = CanNetworkInterface.GetAllInterfaces(true)
                .FirstOrDefault(i => string.Equals(i.Name, Interface, StringComparison.Ordinal));
            if (iface == null)
            {
                _logger.LogError(
                    "CAN interface {Interface} not found. Bring it up first, e.g. " +
                    "sudo ip link set {Interface} up type can bitrate 500000, or " +
                    "sudo modprobe vcan && sudo ip link add dev vcan0 type vcan && sudo ip link set vcan0 up.",
                    Interface, Interface);
                SetInhibit("CAN interface not found");
                return;
            }

            var socket = new RawCanSocket();
            socket.Bind(iface);
            // Everything we care about is below 0x200; the mask keeps broadcast,
            // command echo and both nodes' telemetry and drops the rest in the
            // kernel rather than on the Pi's CPU.
            socket.CanFilters = new[] { new CanFilter(0x000, 0x600) };
            socket.ReceiveTimeout = 200;
            _socket = socket;

            _running = true;
            _rxThread = new Thread(ReceiveLoop) { IsBackground = true, Name = "can-track-rx" };
            _txThread = new Thread(TransmitLoop) { IsBackground = true, Name = "can-track-tx" };
            _rxThread.Start();
            _txThread.Start();

            _logger.LogInformation(
                "CAN track drive up on {Interface}, command every {Interval} ms, expecting {Nodes} node(s).",
                Interface, CommandIntervalMs, ExpectedNodes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to open CAN interface {Interface}.", Interface);
            SetInhibit("CAN open failed");
        }
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
        }
    }

    internal void ReleaseAxis(TrackDriveAxis axis)
    {
        switch (axis)
        {
            case TrackDriveAxis.Throttle:
            case TrackDriveAxis.Steering:
                lock (_stateLock) { _throttle = 0f; _steering = 0f; }
                break;
            case TrackDriveAxis.Left:
                lock (_stateLock) { _directLeft = 0f; }
                break;
            case TrackDriveAxis.Right:
                lock (_stateLock) { _directRight = 0f; }
                break;
        }
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
            _mode = mode;
            clearFault = now < _faultResetUntilTicks;
            sequence = unchecked(++_sequence);
        }

        var data = new byte[8];
        CanTrackProtocol.WriteInt16(data, 0, CanTrackProtocol.ToWire(_commandedLeft * 100.0));
        CanTrackProtocol.WriteInt16(data, 2, CanTrackProtocol.ToWire(_commandedRight * 100.0));
        data[4] = (byte)mode;
        data[5] = clearFault ? CanTrackProtocol.CommandFlagClearFault : (byte)0;
        CanTrackProtocol.WriteUInt16(data, 6, sequence);

        Send(CanTrackProtocol.CommandId, data);
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

        var present = 0;
        string? faulted = null;
        for (var i = 0; i < _nodes.Length && i < ExpectedNodes; i++)
        {
            var n = _nodes[i];
            if (n.Seen && nowMs - n.LastSeenMs <= NodeTimeoutMs) present++;
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
        _inhibitReason = faulted;
    }

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
                _logger.LogWarning(ex, "CAN write failed ({Count} total).", failures);
            }
        }
    }

    // --- receive -------------------------------------------------------------

    private void ReceiveLoop()
    {
        while (_running)
        {
            try
            {
                var socket = _socket;
                if (socket == null) break;
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
    }

    private void Dispatch(CanFrame frame)
    {
        const uint effFlag = 0x80000000u;
        const uint rtrFlag = 0x40000000u;
        const uint errFlag = 0x20000000u;

        if ((frame.CanId & (effFlag | rtrFlag | errFlag)) != 0) return;
        var id = frame.CanId & 0x7FFu;
        var data = frame.Data;
        var len = frame.Length;

        Interlocked.Increment(ref _framesReceived);

        for (var node = 0; node < _nodes.Length; node++)
        {
            if (id == CanTrackProtocol.StatusId(node)) { ApplyStatus(node, data, len); return; }
            if (id == CanTrackProtocol.PowerId(node)) { ApplyPower(node, data, len); return; }
            if (id == CanTrackProtocol.FaultId(node)) { ApplyFault(node, data, len); return; }
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

    private void ApplyStatus(int node, byte[] d, int len)
    {
        if (len < 8) return;
        lock (_stateLock)
        {
            var n = _nodes[node];
            n.Seen = true;
            n.LastSeenMs = _clock.ElapsedMilliseconds;
            n.Speed = CanTrackProtocol.ReadInt16(d, 0) / 100.0;
            n.Target = CanTrackProtocol.ReadInt16(d, 2) / 100.0;
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
        }
        else
        {
            _logger.LogError("Node {Node} faulted: {Fault}.", node, CanTrackProtocol.Describe(current));
        }
    }

    // --- snapshot ------------------------------------------------------------

    public TrackDriveSnapshot GetSnapshot()
    {
        EnsureStarted();
        lock (_stateLock)
        {
            var now = _clock.ElapsedMilliseconds;
            RefreshPresence(now);
            var present = _nodes.Take(Math.Max(1, ExpectedNodes))
                                .Count(n => n.Seen && now - n.LastSeenMs <= NodeTimeoutMs);
            return new TrackDriveSnapshot
            {
                Left = _nodes[CanTrackProtocol.LeftNode].ToState(now),
                Right = _nodes[CanTrackProtocol.RightNode].ToState(now),
                BusUp = _socket != null,
                AllNodesPresent = present >= ExpectedNodes,
                DriveEnabled = _inhibitReason == null,
                InhibitReason = _inhibitReason,
                CommandedLeft = _commandedLeft,
                CommandedRight = _commandedRight,
                Mode = _mode,
                FramesSent = Interlocked.Read(ref _framesSent),
                FramesReceived = Interlocked.Read(ref _framesReceived),
                SendFailures = Interlocked.Read(ref _sendFailures),
                UnknownFrames = Interlocked.Read(ref _unknownFrames),
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
