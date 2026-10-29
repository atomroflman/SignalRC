using System.IO.Ports;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>The latest view of the world, for anything that needs it.</summary>
public interface ILidarSource : IModule
{
    /// <summary>Most recent completed revolution, or null if none yet. The scan
    /// is immutable once handed over.</summary>
    LdsScan? LatestScan { get; }
    LidarHealth Health { get; }
}

public sealed record LidarHealth
{
    public bool PortOpen { get; init; }
    public bool Spinning { get; init; }
    public double Rpm { get; init; }
    /// <summary>Seconds since the last completed revolution. Infinite if none.</summary>
    public double ScanAgeSeconds { get; init; } = double.PositiveInfinity;
    public int Gaps { get; init; }
    public long Scans { get; init; }
    public long ChecksumErrors { get; init; }
    public long IndexErrors { get; init; }
    public long BytesDiscarded { get; init; }
    public long Reconnects { get; init; }
    public string? Problem { get; init; }
}

/// <summary>
/// Reads the FM1828 off a serial port and keeps the latest scan.
///
/// An <see cref="IModuleManager"/> like the CAN drive, so it is configured as
/// a pinManager and anything that needs scans asks the factory for it by name.
/// That matters for more than tidiness: the telemetry reader wants scans now,
/// and a collision loop will want the same ones later, at full rate. Going
/// through the factory means they share one port rather than fighting over it.
///
/// The sensor is a vacuum cleaner part with no datasheet. It is also an INDOOR
/// part, built for 8 m and artificial light - direct sun raises the noise
/// floor of a time-of-flight unit in this class, and that has to be measured
/// before anything safety related is built on it.
/// </summary>
public sealed class LdsLidarManager : IModuleManager, ILidarSource, IDisposable
{
    private readonly ILogger<LdsLidarManager> _logger;
    private readonly LdsFramer _framer = new();
    private readonly object _lock = new();

    private SerialPort? _port;
    private Thread? _thread;
    private volatile bool _running;
    private bool _started;
    private bool _disposed;

    private LdsScan? _latest;
    private DateTime _latestUtc = DateTime.MinValue;
    private long _reconnects;
    private bool _everOpened;
    private string? _problem;
    private FileStream? _capture;

    /// <summary>Serial device. A udev rule giving the adapter a stable name is
    /// worth setting up: /dev/ttyUSB0 moves around when anything else is
    /// plugged in, and the drive is on the same machine.</summary>
    public string Port { get; set; } = "/dev/lidar";

    public int BaudRate { get; set; } = 115200;

    /// <summary>No completed revolution for this long means the motor is not
    /// turning. The wake command is then resent before giving up on the port -
    /// a spin-down is far more likely than a dead adapter.</summary>
    public int StallTimeoutMs { get; set; } = 2000;

    /// <summary>Raw bytes are copied here when set. For verifying the protocol
    /// against a real unit, which is the one thing a synthetic test cannot do.
    /// Leave empty in normal operation; this writes about 11 KB a second.</summary>
    public string CapturePath { get; set; } = string.Empty;

    public LdsLidarManager(ILogger<LdsLidarManager> logger) => _logger = logger;

    public LdsScan? LatestScan { get { lock (_lock) return _latest; } }

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
                    Rpm = _framer.LastRpm,
                    ScanAgeSeconds = age,
                    Gaps = _framer.LastScanGaps,
                    Scans = _framer.ScansCompleted,
                    ChecksumErrors = _framer.ChecksumErrors,
                    IndexErrors = _framer.IndexErrors,
                    BytesDiscarded = _framer.BytesDiscarded,
                    Reconnects = _reconnects,
                    Problem = _problem,
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
                $"LdsLidarManager provides ILidarSource, not {typeof(T).Name}.");
        }
        return module;
    }

    /// <summary>
    /// Opened lazily, like the CAN manager and for the same reason: the
    /// factory sets the options by property AFTER construction, so Port is
    /// still at its default while the constructor runs.
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
        _logger.LogInformation("Lidar reader started on {Port} at {Baud} baud.", Port, BaudRate);
    }

    private void ReadLoop()
    {
        var buffer = new byte[1024];
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
                    _framer.Push(buffer.AsSpan(0, read), OnScan);
                }
            }
            catch (TimeoutException)
            {
                // Normal on a quiet port. Only interesting if it persists,
                // which the stall check below decides.
            }
            catch (Exception ex) when (_running)
            {
                lock (_lock) _problem = ex.Message;
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
            // The device may not exist yet - udev settles after boot, and the
            // adapter can be plugged in later. Say so once rather than on
            // every retry.
            if (!File.Exists(Port))
            {
                SetProblemOnce($"{Port} does not exist");
                return false;
            }

            var port = new SerialPort(Port, BaudRate, Parity.None, 8, StopBits.One)
            {
                ReadTimeout = 500,
                WriteTimeout = 500,
            };
            port.Open();
            port.DiscardInBuffer();
            _port = port;

            if (!string.IsNullOrWhiteSpace(CapturePath))
            {
                _capture ??= new FileStream(CapturePath, FileMode.Create, FileAccess.Write);
                _logger.LogWarning("Lidar raw capture is on, writing to {Path}.", CapturePath);
            }

            SendStart();
            lock (_lock)
            {
                _problem = null;
                // The first open is not a reconnect; only count coming back.
                if (_everOpened) _reconnects++;
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

    private void SendStart()
    {
        try
        {
            // The module idles until told to spin, and then streams on its own.
            _port?.Write(LdsProtocol.StartCommand, 0, LdsProtocol.StartCommand.Length);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not send the lidar start command.");
        }
    }

    private DateTime _lastStartUtc = DateTime.MinValue;

    private void CheckStall()
    {
        DateTime last;
        lock (_lock) last = _latestUtc;
        if (last != DateTime.MinValue &&
            (DateTime.UtcNow - last).TotalMilliseconds < StallTimeoutMs) return;

        // Bytes may still be arriving while the motor is stopped, so a quiet
        // port is not the test - a missing revolution is. Resend rather than
        // reopen: a spin-down is far more likely than a dead adapter, and
        // reopening would drop the stream for nothing.
        if ((DateTime.UtcNow - _lastStartUtc).TotalSeconds < 2) return;
        _lastStartUtc = DateTime.UtcNow;
        SetProblemOnce("no complete revolution, motor may be stopped");
        SendStart();
    }

    private void OnScan(LdsScan scan)
    {
        lock (_lock)
        {
            _latest = scan;
            _latestUtc = DateTime.UtcNow;
            _problem = null;
        }
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
