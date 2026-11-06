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
        public required Microsoft.Win32.SafeHandles.SafeFileHandle Handle { get; init; }
        public bool CanRumble { get; init; }
        /// <summary>Name of the kernel input device (e.g. input14): its LEDs are /sys/class/leds/input14:*.</summary>
        public string? InputName { get; init; }
        public readonly object OutputLock = new();
        public short EffectId = -1;
        public bool Playing;
        public (ushort Strong, ushort Weak) Rumble, WantedRumble;
        public long RumbleWantedAtMs, RumbleAtMs;
        public (byte R, byte G, byte B)? Light, WantedLight;
        public long LightAtMs;
        public long LastOutputMs;
        public bool LightDenied;
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
    private Timer? _outputTimer;
    private int _scanning;

    /// <summary>
    /// A DualShock 4 on Bluetooth stops reporting after a while without a message from the
    /// host, although it stays connected; something is sent to every controller that can
    /// rumble at least this often (a rumble of strength 0).
    /// </summary>
    public const int KeepAliveMs = 5000;
    /// <summary>A rumble the flow no longer asks for ends after this time (flow cleared, node removed).</summary>
    public const int RumbleHoldMs = 500;
    private const int MinOutputIntervalMs = 40;
    private const string LedDirectory = "/sys/class/leds";
    private static long NowMs => Environment.TickCount64;

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
        _outputTimer ??= new Timer(_ => ServiceOutputs(), null, TimeSpan.FromMilliseconds(250), TimeSpan.FromMilliseconds(250));
    }

    private IEnumerable<Device> Matching(string? filter)
    {
        var f = filter?.Trim() ?? string.Empty;
        return _byPath.Values.Where(d => d.Connected && (f.Length == 0
            || d.Info.Name.Contains(f, StringComparison.OrdinalIgnoreCase) || d.Info.Key.Contains(f, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// Rumble of the matching controllers (name part or address; empty = all), strengths
    /// 0…1. Called every flow tick; a controller is only told about changes, and the rumble
    /// stops when nobody asks for it for <see cref="RumbleHoldMs"/>.
    /// </summary>
    public void SetRumble(string? filter, double strong, double weak)
    {
        var wanted = (ToMotor(strong), ToMotor(weak));
        foreach (var device in Matching(filter).Where(d => d.CanRumble))
            lock (device.OutputLock)
            {
                device.WantedRumble = wanted;
                device.RumbleWantedAtMs = NowMs;
                ApplyRumble(device);
            }
    }

    /// <summary>Light bar colour of the matching controllers, channels 0…1; written on change.</summary>
    public void SetLight(string? filter, double red, double green, double blue)
    {
        var wanted = (ToByte(red), ToByte(green), ToByte(blue));
        foreach (var device in Matching(filter).Where(d => d.InputName != null))
            lock (device.OutputLock)
            {
                device.WantedLight = wanted;
                ApplyLight(device);
            }
    }

    private static ushort ToMotor(double v) => double.IsFinite(v) ? (ushort)Math.Round(Math.Clamp(v, 0, 1) * 0xffff) : (ushort)0;
    private static byte ToByte(double v) => double.IsFinite(v) ? (byte)Math.Round(Math.Clamp(v, 0, 1) * 255) : (byte)0;

    private void ApplyRumble(Device device)
    {
        var now = NowMs;
        if (device.WantedRumble == device.Rumble || now - device.RumbleAtMs < MinOutputIntervalMs) return;
        var (strong, weak) = device.WantedRumble;
        var id = Evdev.UploadRumble(device.Handle, device.EffectId, strong, weak, 0);
        if (id < 0) return;
        device.EffectId = id;
        var on = strong > 0 || weak > 0;
        if (on != device.Playing && Evdev.WriteEvent(device.Handle, Evdev.EV_FF, id, on ? 1 : 0))
            device.Playing = on;
        device.Rumble = device.WantedRumble;
        device.RumbleAtMs = now;
        device.LastOutputMs = now;
    }

    private void ApplyLight(Device device)
    {
        var now = NowMs;
        if (device.WantedLight == null || device.WantedLight == device.Light || device.LightDenied || now - device.LightAtMs < MinOutputIntervalMs) return;
        var (r, g, b) = device.WantedLight.Value;
        try
        {
            var multi = Path.Combine(LedDirectory, device.InputName + ":rgb:indicator");
            if (Directory.Exists(multi))
            {
                // DualSense: one multicolour LED.
                File.WriteAllText(Path.Combine(multi, "multi_intensity"), $"{r} {g} {b}");
                File.WriteAllText(Path.Combine(multi, "brightness"), "255");
            }
            else
            {
                // DualShock 4: one LED per colour plus "global", which switches the bar on.
                WriteLed(device.InputName + ":red", r);
                WriteLed(device.InputName + ":green", g);
                WriteLed(device.InputName + ":blue", b);
                var global = Path.Combine(LedDirectory, device.InputName + ":global");
                if (Directory.Exists(global)) File.WriteAllText(Path.Combine(global, "brightness"), "1");
            }
            device.Light = device.WantedLight;
            device.LightAtMs = now;
            device.LastOutputMs = now;
        }
        catch (UnauthorizedAccessException)
        {
            device.LightDenied = true;
            _logger.LogWarning("No permission to set the light of {Name}: run scripts/onboard-setup-bluetooth.sh (udev rule for the controller LEDs).", device.Info.Name);
        }
        catch (Exception ex) when (ex is IOException or DirectoryNotFoundException)
        {
            _logger.LogDebug(ex, "Setting the light of {Name} failed.", device.Info.Name);
            device.LightAtMs = now;
        }
    }

    private static void WriteLed(string name, byte value)
    {
        var dir = Path.Combine(LedDirectory, name);
        if (!Directory.Exists(dir)) return;
        var max = int.TryParse(File.ReadAllText(Path.Combine(dir, "max_brightness")).Trim(), out var m) && m > 0 ? m : 255;
        File.WriteAllText(Path.Combine(dir, "brightness"), ((int)Math.Round(value * max / 255.0)).ToString(System.Globalization.CultureInfo.InvariantCulture));
    }

    /// <summary>Every 250 ms: pending outputs, the end of an orphaned rumble and the keep-alive.</summary>
    private void ServiceOutputs()
    {
        var now = NowMs;
        foreach (var device in _byPath.Values.Where(d => d.Connected))
        {
            try
            {
                lock (device.OutputLock)
                {
                    if (device.WantedRumble != (0, 0) && now - device.RumbleWantedAtMs > RumbleHoldMs)
                        device.WantedRumble = (0, 0);
                    ApplyRumble(device);
                    ApplyLight(device);
                    if (device.CanRumble && now - device.LastOutputMs >= KeepAliveMs)
                        KeepAlive(device, now);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Output to {Name} failed.", device.Info.Name);
            }
        }
    }

    private void KeepAlive(Device device, long now)
    {
        device.LastOutputMs = now;
        if (device.Playing)
        {
            // Updating the running effect sends the current strengths again.
            Evdev.UploadRumble(device.Handle, device.EffectId, device.Rumble.Strong, device.Rumble.Weak, 0);
            return;
        }
        var id = Evdev.UploadRumble(device.Handle, device.EffectId, 0, 0, 1);
        if (id < 0) return;
        device.EffectId = id;
        Evdev.WriteEvent(device.Handle, Evdev.EV_FF, id, 1);
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
            var device = new Device
            {
                Info = info,
                Stream = new FileStream(handle, FileAccess.Read, 0),
                Handle = handle,
                CanRumble = Evdev.HasRumble(handle),
                InputName = InputNameOf(path),
            };
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
            _logger.LogInformation("Controller connected: {Name} ({Key}), {Axes} axes, {Keys} buttons, rumble {Rumble}, LEDs {Leds}",
                info.Name, info.Key, info.Axes.Count, info.Keys.Count, device.CanRumble ? "yes" : "no", device.InputName ?? "-");
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

    /// <summary>The kernel input device behind /dev/input/eventN (e.g. input14), null if unknown.</summary>
    private static string? InputNameOf(string eventPath)
    {
        try
        {
            var link = new DirectoryInfo($"/sys/class/input/{Path.GetFileName(eventPath)}/device").ResolveLinkTarget(true);
            return link?.Name;
        }
        catch
        {
            return null;
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
        _outputTimer?.Dispose();
        foreach (var device in _byPath.Values)
        {
            device.Connected = false;
            try { device.Stream.Dispose(); } catch { /* ignore */ }
        }
    }
}
