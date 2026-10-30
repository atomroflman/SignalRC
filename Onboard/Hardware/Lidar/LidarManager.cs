using System.IO.Ports;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>The latest view of the world, for anything that needs it.</summary>
public interface ILidarSource : IModule
{
    /// <summary>Most recent revolution, cleaned. Null if none yet. Immutable
    /// once handed over.</summary>
    LidarScan? LatestScan { get; }
    /// <summary>The same revolution before filtering, so the filter can be
    /// judged against what it was given.</summary>
    LidarScan? LatestRawScan { get; }
    LidarHealth Health { get; }
}

public sealed record LidarHealth
{
    public bool PortOpen { get; init; }
    public bool Spinning { get; init; }
    public double Rpm { get; init; }
    /// <summary>Seconds since the last revolution. Infinite if none.</summary>
    public double ScanAgeSeconds { get; init; } = double.PositiveInfinity;
    /// <summary>Slots with no usable distance in the last revolution.</summary>
    public int Gaps { get; init; }
    public long Scans { get; init; }
    public long CrcErrors { get; init; }
    public long BytesDiscarded { get; init; }
    public long Reconnects { get; init; }
    /// <summary>Revolutions lost between sequence numbers. Climbing means this
    /// host is not reading fast enough, or something else has the port.</summary>
    public long SequenceGaps { get; init; }
    public bool NeedsPowerCycle { get; init; }
    public string? Problem { get; init; }

    /// <summary>The Pico's own counters, or null until the first status frame.</summary>
    public LidarStatus? Pico { get; init; }
}

/// <summary>
/// Reads the lidar off the RP2040 bridge and keeps the latest revolution.
///
/// An <see cref="IModuleManager"/> like the CAN drive, so it is configured as
/// a pinManager and anything needing scans asks the factory for it by name.
/// The telemetry reader wants them now and a collision loop will want the same
/// ones later at full rate; going through the factory means they share one
/// port rather than fighting over it.
///
/// That last point is not hypothetical. The first capture taken on this
/// hardware was two thirds corrupt because a GUI still held the port - two
/// readers each getting fragments. Hence <see cref="LidarHealth.SequenceGaps"/>
/// and the discarded-byte counter: they name that failure instead of leaving
/// it to look like a broken sensor.
/// </summary>
public sealed class LidarManager : IModuleManager, ILidarSource, IDisposable
{
    private readonly ILogger<LidarManager> _logger;
    private readonly LidarFramer _framer = new();
    private readonly LidarScanFilter _filter = new();
    private readonly object _lock = new();

    private SerialPort? _port;
    private Thread? _thread;
    private volatile bool _running;
    private bool _started;
    private bool _disposed;

    private LidarScan? _latest;
    private LidarScan? _latestRaw;
    private DateTime _latestUtc = DateTime.MinValue;
    private LidarStatus? _status;
    private uint _lastSequence;
    private bool _haveSequence;
    private long _sequenceGaps;
    private long _reconnects;
    private bool _everOpened;
    private string? _problem;
    private FileStream? _capture;

    /// <summary>Serial device. A udev rule giving the Pico a stable name is
    /// worth the five minutes: /dev/ttyACM0 moves when anything else is
    /// plugged in, and the drive is on the same machine.</summary>
    public string Port { get; set; } = "/dev/lidar";

    /// <summary>USB CDC ignores the rate, but 1200 would put an RP2040 into
    /// its bootloader, so this is not a free choice.</summary>
    public int BaudRate { get; set; } = 115200;

    /// <summary>No revolution for this long counts as stalled.</summary>
    public int StallTimeoutMs { get; set; } = 2000;

    /// <summary>Plain START attempts before escalating to a power cycle.</summary>
    public int StartAttempts { get; set; } = 3;

    /// <summary>Power cycles to try after START has failed. The Pico owns the
    /// sensor's 5 V rail, so this is a real recovery route and not a
    /// formality - but it takes about seven seconds each time.</summary>
    public int RestartAttempts { get; set; } = 2;

    /// <summary>Raw bytes are copied here when set. For checking the protocol
    /// against the real thing, which is the one job a synthetic test cannot
    /// do. About 15 kB a second; leave empty in normal operation.</summary>
    public string CapturePath { get; set; } = string.Empty;

    /// <summary>How many recent revolutions a slot has to appear in. 1
    /// disables the window.</summary>
    public int WindowScans { get => _filter.WindowScans; set => _filter.WindowScans = value; }

    /// <summary>How many of the window must carry a return.</summary>
    public int MinHits { get => _filter.MinHits; set => _filter.MinHits = value; }

    public LidarManager(ILogger<LidarManager> logger) => _logger = logger;

    public LidarScan? LatestScan { get { lock (_lock) return _latest; } }
    public LidarScan? LatestRawScan { get { lock (_lock) return _latestRaw; } }

    public LidarHealth Health
    {
        get
        {
            lock (_lock)
            {
                var age = _latestUtc == DateTime.MinValue
                    ? double.PositiveInfinity
                    : (DateTime.UtcNow - _latestUtc).TotalSeconds;
                return new LidarHealth
                {
                    PortOpen = _port?.IsOpen == true,
                    Spinning = age < StallTimeoutMs / 1000.0,
                    Rpm = _latest?.Rpm ?? 0.0,
                    ScanAgeSeconds = age,
                    Gaps = _latest?.Gaps ?? LidarProtocol.PointsPerRevolution,
                    Scans = _framer.ScansDecoded,
                    CrcErrors = _framer.CrcErrors,
                    BytesDiscarded = _framer.BytesDiscarded,
                    Reconnects = _reconnects,
                    SequenceGaps = _sequenceGaps,
                    NeedsPowerCycle = _needsPowerCycle
                        || _status?.State == LidarProtocol.PicoState.Stopped,
                    Problem = _problem,
                    Pico = _status,
                };
            }
        }
    }

    public T GetModule<T>(int address) where T : class, IModule
    {
        EnsureStarted();
        if (this is not T module)
        {
            throw new InvalidCastException(
                $"LidarManager provides ILidarSource, not {typeof(T).Name}.");
        }
        return module;
    }

    /// <summary>
    /// Opened lazily: the factory sets the options by property AFTER
    /// construction, so Port is still at its default while the constructor
    /// runs.
    /// </summary>
    public void EnsureStarted()
    {
        lock (_lock)
        {
            if (_started || _disposed) return;
            _started = true;
        }
        _running = true;
        _thread = new Thread(ReadLoop) { IsBackground = true, Name = "lidar-rx" };
        _thread.Start();
        _logger.LogInformation("Lidar reader started on {Port}.", Port);
    }

    private void ReadLoop()
    {
        var buffer = new byte[4096];
        while (_running)
        {
            if (!EnsureOpen())
            {
                Thread.Sleep(1000);
                continue;
            }

            try
            {
                var read = _port!.Read(buffer, 0, buffer.Length);
                if (read > 0)
                {
                    _capture?.Write(buffer, 0, read);
                    _framer.Push(buffer.AsSpan(0, read), OnScan, OnStatus, OnLog);
                }
            }
            catch (TimeoutException)
            {
                // Normal on a quiet port. The stall check decides if it matters.
            }
            catch (Exception ex) when (_running)
            {
                SetProblemOnce(ex.Message);
                _logger.LogWarning(ex, "Lidar read failed, reopening {Port}.", Port);
                ClosePort();
                continue;
            }

            CheckStall();
        }
        ClosePort();
    }

    private bool EnsureOpen()
    {
        if (_port?.IsOpen == true) return true;
        try
        {
            // Not existing yet is a normal state, not an error: udev settles
            // after boot and the Pico can be plugged in later.
            if (!File.Exists(Port))
            {
                SetProblemOnce($"{Port} does not exist");
                return false;
            }

            var port = new SerialPort(Port, BaudRate, Parity.None, 8, StopBits.One)
            {
                ReadTimeout = 500,
                WriteTimeout = 500,
                DtrEnable = true,
            };
            port.Open();
            port.DiscardInBuffer();
            _port = port;

            // The window describes a world the vehicle may have driven out of
            // while the port was down.
            _filter.Reset();
            lock (_lock) { _haveSequence = false; }

            if (!string.IsNullOrWhiteSpace(CapturePath))
            {
                _capture ??= new FileStream(CapturePath, FileMode.Create, FileAccess.Write);
                _logger.LogWarning("Lidar raw capture is on, writing to {Path}.", CapturePath);
            }

            SendCommand(LidarProtocol.CommandStart);
            lock (_lock)
            {
                _problem = null;
                if (_everOpened) _reconnects++;   // the first open is not a reconnect
                _everOpened = true;
            }
            _logger.LogInformation("Lidar port {Port} open.", Port);
            return true;
        }
        catch (Exception ex)
        {
            SetProblemOnce(ex.Message);
            return false;
        }
    }

    /// <summary>Commands are plain ASCII lines, so the link can also be driven
    /// by hand from a terminal while the binary stream runs the other way.</summary>
    public void SendCommand(string command)
    {
        try
        {
            _port?.Write(command.Trim() + "\n");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send lidar command {Command}.", command);
        }
    }

    private DateTime _lastStartUtc = DateTime.MinValue;
    private int _startAttempts;
    private bool _needsPowerCycle;

    private void CheckStall()
    {
        DateTime last;
        LidarProtocol.PicoState? state;
        lock (_lock) { last = _latestUtc; state = _status?.State; }

        var spinning = last != DateTime.MinValue &&
                       (DateTime.UtcNow - last).TotalMilliseconds < StallTimeoutMs;
        if (spinning)
        {
            _startAttempts = 0;
            _needsPowerCycle = false;
            return;
        }

        if (_needsPowerCycle) return;
        if ((DateTime.UtcNow - _lastStartUtc).TotalSeconds < 3) return;
        _lastStartUtc = DateTime.UtcNow;
        var where = LidarProtocol.Describe(state ?? LidarProtocol.PicoState.Booting);

        // Escalate rather than repeat. START works from cold, but once the
        // sensor has been told to stop it sits in a LOCKED idle and no amount
        // of starting brings it back - it has to lose its 5 V first. That was
        // measured on this hardware: after a stop the Pico reports plain
        // "idle", not "stopped", so keying the power cycle off the state alone
        // would never fire it.
        //
        // The Pico owns the power switch, so unlike a bare USB sensor this is
        // recoverable without anyone walking over to the vehicle. Worth using.
        if (++_startAttempts <= StartAttempts)
        {
            SetProblemOnce($"no revolution, retrying START (Pico state: {where})");
            SendCommand(LidarProtocol.CommandStart);
            return;
        }

        if (_startAttempts <= StartAttempts + RestartAttempts)
        {
            // RESTART is power off 1.5 s, on, settle 2.5 s, then the start
            // sequence - so it needs several seconds before it can be judged.
            _lastStartUtc = DateTime.UtcNow.AddSeconds(7);
            SetProblemOnce($"START did not take, power cycling the sensor (Pico state: {where})");
            _logger.LogWarning("Lidar not spinning after {N} starts, sending RESTART.", StartAttempts);
            SendCommand(LidarProtocol.CommandRestart);
            return;
        }

        _needsPowerCycle = true;
        SetProblemOnce("not spinning after starts and power cycles - needs attention");
        _logger.LogError(
            "Lidar will not spin up on {Port}. Pico state {State}. Tried {S} starts and " +
            "{R} power cycles; nothing further will be attempted automatically.",
            Port, where, StartAttempts, RestartAttempts);
    }

    private void OnScan(LidarScan scan)
    {
        // Filtered outside the lock: the median across the window is real work
        // and the read loop is the only caller, so nobody is waiting on it.
        var filtered = _filter.Apply(scan);
        lock (_lock)
        {
            if (_haveSequence)
            {
                var step = scan.Sequence - _lastSequence;
                if (step > 1) _sequenceGaps += step - 1;
            }
            _lastSequence = scan.Sequence;
            _haveSequence = true;

            _latestRaw = scan;
            _latest = filtered;
            _latestUtc = DateTime.UtcNow;
            _problem = null;
        }
    }

    private void OnStatus(LidarStatus status)
    {
        lock (_lock) _status = status;
    }

    private void OnLog(string text)
    {
        _logger.LogInformation("Lidar: {Text}", text);
    }

    private void SetProblemOnce(string message)
    {
        lock (_lock)
        {
            if (_problem == message) return;
            _problem = message;
        }
        _logger.LogWarning("Lidar: {Problem}", message);
    }

    private void ClosePort()
    {
        try { _port?.Close(); } catch { /* going away anyway */ }
        _port?.Dispose();
        _port = null;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
        }
        _running = false;
        _thread?.Join(1000);
        ClosePort();
        _capture?.Dispose();
        _capture = null;
    }
}
