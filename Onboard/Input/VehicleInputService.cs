using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Flow;

namespace SignalRC.Onboard.Input;

/// <summary>
/// Controllers connected to the vehicle (Bluetooth or USB), read through evdev (OF07).
/// Looks for new devices every 2 s; a device that stops delivering counts as disconnected,
/// and its values are no longer offered (the flow sees connected = 0, value 0).
/// </summary>
public sealed class VehicleInputService : IDisposable
{
    public const string InputDirectory = "/dev/input";
    private static readonly TimeSpan ScanInterval = TimeSpan.FromSeconds(2);

    private sealed class Device
    {
        public required Evdev.DeviceInfo Info { get; init; }
        public required FileStream Stream { get; init; }
        public ConcurrentDictionary<int, double> Axes { get; } = new();
        public ConcurrentDictionary<int, double> Keys { get; } = new();
        public volatile bool Connected = true;
    }

    private readonly ILogger<VehicleInputService> _logger;
    private readonly ConcurrentDictionary<string, Device> _byPath = new(StringComparer.Ordinal);
    // Paths that are not controllers or cannot be opened: not tried again until they disappear.
    private readonly ConcurrentDictionary<string, bool> _ignored = new(StringComparer.Ordinal);
    // Every controller seen since start, so the server keeps the channels while one is off.
    private readonly ConcurrentDictionary<string, VehicleInputDeviceInfo> _known = new(StringComparer.Ordinal);
    private Timer? _timer;
    private int _scanning;

    /// <summary>A controller was used (button or a stick moved noticeably): counts as session activity (T10).</summary>
    public event Action? Activity;
    /// <summary>A controller came or went.</summary>
    public event Action? DevicesChanged;

    public VehicleInputService(ILogger<VehicleInputService> logger)
    {
        _logger = logger;
    }

    public void Start()
    {
        if (!OperatingSystem.IsLinux() || !Directory.Exists(InputDirectory))
        {
            _logger.LogInformation("No {Dir}: vehicle controllers are not available.", InputDirectory);
            return;
        }
        _timer ??= new Timer(_ => Scan(), null, TimeSpan.Zero, ScanInterval);
    }

    /// <summary>Value of an axis or button; (0, false) while the controller is not connected.</summary>
    public (double Value, bool Connected) Get(string deviceKey, int code, bool isAxis)
    {
        foreach (var device in _byPath.Values)
        {
            if (!device.Connected || device.Info.Key != deviceKey) continue;
            var values = isAxis ? device.Axes : device.Keys;
            return (values.TryGetValue(code, out var v) ? v : 0, true);
        }
        return (0, false);
    }

    /// <summary>All controllers seen since start, with their channels.</summary>
    public VehicleInputDeviceInfo[] KnownDevices() => _known.Values.OrderBy(d => d.Name).ThenBy(d => d.Key).ToArray();

    /// <summary>Known controllers and whether they are connected right now.</summary>
    public List<VehicleInputDeviceState> States()
    {
        var connected = _byPath.Values.Where(d => d.Connected).Select(d => d.Info.Key).ToHashSet(StringComparer.Ordinal);
        return _known.Values
            .Select(d => new VehicleInputDeviceState { Key = d.Key, Name = d.Name, Connected = connected.Contains(d.Key) })
            .OrderBy(d => d.Name).ThenBy(d => d.Key).ToList();
    }

    private void Scan()
    {
        if (Interlocked.Exchange(ref _scanning, 1) == 1) return;
        try
        {
            var present = Directory.GetFiles(InputDirectory, "event*").ToHashSet(StringComparer.Ordinal);
            foreach (var path in _ignored.Keys.Where(p => !present.Contains(p)).ToList())
                _ignored.TryRemove(path, out _);
            var changed = false;
            foreach (var (path, device) in _byPath.ToList())
            {
                if (device.Connected && present.Contains(path)) continue;
                _byPath.TryRemove(path, out _);
                device.Connected = false;
                try { device.Stream.Dispose(); } catch { /* already gone */ }
                _logger.LogInformation("Controller disconnected: {Name} ({Key})", device.Info.Name, device.Info.Key);
                changed = true;
            }
            foreach (var path in present.OrderBy(p => p))
            {
                if (_byPath.ContainsKey(path) || _ignored.ContainsKey(path)) continue;
                changed |= TryOpen(path);
            }
            if (changed) DevicesChanged?.Invoke();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Scanning for controllers failed.");
        }
        finally
        {
            Interlocked.Exchange(ref _scanning, 0);
        }
    }

    private bool TryOpen(string path)
    {
        Microsoft.Win32.SafeHandles.SafeFileHandle? handle = null;
        try
        {
            handle = Evdev.Open(path);
            var info = Evdev.Describe(path, handle);
            if (!info.IsGameController)
            {
                handle.Dispose();
                _ignored[path] = true;
                return false;
            }
            var device = new Device { Info = info, Stream = new FileStream(handle, FileAccess.Read, 0) };
            foreach (var (code, abs) in info.Axes)
                device.Axes[code] = Evdev.Normalize(code, abs, abs.Value);
            _byPath[path] = device;
            _known[info.Key] = new VehicleInputDeviceInfo
            {
                Key = info.Key,
                Name = info.Name,
                Channels = info.Axes.Keys.Order().Select(c => new VehicleInputChannelInfo { Code = c, IsAxis = true, Name = Evdev.AxisName(c) })
                    .Concat(info.Keys.Where(k => k >= Evdev.BTN_MISC).Select(c => new VehicleInputChannelInfo { Code = c, IsAxis = false, Name = Evdev.KeyName(c) }))
                    .ToList(),
            };
            new Thread(() => ReadLoop(device)) { IsBackground = true, Name = $"evdev {Path.GetFileName(path)}" }.Start();
            _logger.LogInformation("Controller connected: {Name} ({Key}), {Axes} axes, {Keys} buttons", info.Name, info.Key, info.Axes.Count, info.Keys.Count);
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            handle?.Dispose();
            _ignored[path] = true;
            _logger.LogWarning("No permission to read {Path}: the onboard user must be in the 'input' group.", path);
            return false;
        }
        catch (Exception ex)
        {
            handle?.Dispose();
            _ignored[path] = true;
            _logger.LogDebug(ex, "Input device {Path} skipped.", path);
            return false;
        }
    }

    private void ReadLoop(Device device)
    {
        var size = Evdev.EventSize;
        var buffer = new byte[size * 64];
        try
        {
            while (device.Connected)
            {
                var read = device.Stream.Read(buffer, 0, buffer.Length);
                if (read <= 0) break;
                var active = false;
                for (var o = 0; o + size <= read; o += size)
                {
                    var (type, code, value) = Evdev.ParseEvent(buffer.AsSpan(o, size));
                    if (type == Evdev.EV_ABS && device.Info.Axes.TryGetValue(code, out var abs))
                    {
                        var v = Evdev.Normalize(code, abs, value);
                        var previous = device.Axes.TryGetValue(code, out var p) ? p : 0;
                        device.Axes[code] = v;
                        if (Math.Abs(v - previous) > 0.05) active = true;
                    }
                    else if (type == Evdev.EV_KEY)
                    {
                        device.Keys[code] = value > 0 ? 1 : 0;
                        active = true;
                    }
                }
                if (active) Activity?.Invoke();
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException)
        {
            // Device removed (ENODEV) or closed by the scan.
        }
        if (device.Connected)
        {
            device.Connected = false;
            _logger.LogInformation("Controller stopped delivering: {Name} ({Key})", device.Info.Name, device.Info.Key);
            DevicesChanged?.Invoke();
        }
    }

    public void Dispose()
    {
        _timer?.Dispose();
        foreach (var device in _byPath.Values)
        {
            device.Connected = false;
            try { device.Stream.Dispose(); } catch { /* ignore */ }
        }
    }
}
