using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace SignalRC.Onboard.Input;

/// <summary>
/// Minimal Linux evdev access (OnboardFlow-Arbeitspakete.md OF07): device info via ioctl,
/// events via blocking reads. No library: the ioctl numbers are the generic Linux encoding
/// and the same on x86 and ARM.
/// </summary>
public static class Evdev
{
    public const int EV_KEY = 0x01;
    public const int EV_ABS = 0x03;
    public const int EV_FF = 0x15;
    public const int FF_RUMBLE = 0x50;
    private const int FF_MAX = 0x7f;
    public const int ABS_MAX = 0x3f;
    public const int KEY_MAX = 0x2ff;
    public const int BTN_MISC = 0x100;
    public const int BTN_JOYSTICK = 0x120;
    public const int BTN_GAMEPAD = 0x130;
    public const int BTN_THUMBR = 0x13e;

    // Device properties (EVIOCGPROP).
    private const int INPUT_PROP_POINTER = 0x00;
    private const int INPUT_PROP_BUTTONPAD = 0x02;
    private const int INPUT_PROP_ACCELEROMETER = 0x06;

    private static readonly int[] TriggerAxes = [0x02 /*ABS_Z*/, 0x05 /*ABS_RZ*/, 0x09 /*ABS_GAS*/, 0x0a /*ABS_BRAKE*/];

    /// <summary>Size of struct input_event: two longs of time, u16 type, u16 code, s32 value.</summary>
    public static int EventSize => IntPtr.Size == 8 ? 24 : 16;

    public readonly record struct AbsInfo(int Value, int Minimum, int Maximum);

    public sealed class DeviceInfo
    {
        public required string Path { get; init; }
        public required string Name { get; init; }
        public required string Uniq { get; init; }
        public ushort Vendor { get; init; }
        public ushort Product { get; init; }
        public required Dictionary<int, AbsInfo> Axes { get; init; }
        public required List<int> Keys { get; init; }
        public bool IsGameController { get; init; }

        /// <summary>
        /// Stable key of the controller: the Bluetooth address (uniq) plus the name, so the
        /// gamepad node of a controller differs from its motion-sensor node; without uniq
        /// vendor:product plus the name.
        /// </summary>
        public string Key => Uniq.Length > 0 ? $"{Uniq}/{Name}" : $"{Vendor:x4}:{Product:x4}/{Name}";
    }

    [DllImport("libc", SetLastError = true)]
    private static extern int ioctl(int fd, nuint request, byte[] arg);

    private static nuint Ioc(uint dir, uint nr, uint size) => (nuint)((dir << 30) | (size << 16) | ((uint)'E' << 8) | nr);
    private const uint IocRead = 2;

    private static byte[]? IoctlRead(SafeFileHandle handle, uint nr, int size)
    {
        var buffer = new byte[size];
        var fd = (int)handle.DangerousGetHandle();
        return ioctl(fd, Ioc(IocRead, nr, (uint)size), buffer) < 0 ? null : buffer;
    }

    private static string IoctlString(SafeFileHandle handle, uint nr)
    {
        var bytes = IoctlRead(handle, nr, 256);
        if (bytes == null) return string.Empty;
        var end = Array.IndexOf(bytes, (byte)0);
        return Encoding.UTF8.GetString(bytes, 0, end < 0 ? bytes.Length : end).Trim();
    }

    public static bool BitSet(byte[]? bits, int bit) => bits != null && bit / 8 < bits.Length && (bits[bit / 8] & (1 << (bit % 8))) != 0;

    [DllImport("libc", SetLastError = true)]
    private static extern nint write(int fd, byte[] buffer, nint count);

    private const uint IocWrite = 1;

    /// <summary>
    /// Opens a device, for writing too if allowed (rumble and the keep-alive need it), else
    /// read-only. Throws like File.OpenHandle (e.g. no permission at all).
    /// </summary>
    public static SafeFileHandle Open(string path)
    {
        try { return File.OpenHandle(path, FileMode.Open, FileAccess.ReadWrite); }
        catch (UnauthorizedAccessException) { return File.OpenHandle(path, FileMode.Open, FileAccess.Read); }
    }

    /// <summary>Whether the device can rumble (EV_FF with FF_RUMBLE).</summary>
    public static bool HasRumble(SafeFileHandle handle) => BitSet(IoctlRead(handle, 0x20 + EV_FF, (FF_MAX + 8) / 8), FF_RUMBLE);

    /// <summary>
    /// Size of struct ff_effect: 16 bytes header (type, id, direction, trigger, replay, padding)
    /// and the union, whose largest member (periodic, with a pointer) is 32 bytes on 64-bit
    /// and 28 on 32-bit.
    /// </summary>
    public static int FfEffectSize => IntPtr.Size == 8 ? 48 : 44;

    /// <summary>struct ff_effect for a rumble; length 0 plays until stopped.</summary>
    public static byte[] RumbleEffect(short id, ushort strong, ushort weak, ushort lengthMs)
    {
        var e = new byte[FfEffectSize];
        BitConverter.TryWriteBytes(e.AsSpan(0), (ushort)FF_RUMBLE);
        BitConverter.TryWriteBytes(e.AsSpan(2), id);
        BitConverter.TryWriteBytes(e.AsSpan(10), lengthMs);
        BitConverter.TryWriteBytes(e.AsSpan(16), strong);
        BitConverter.TryWriteBytes(e.AsSpan(18), weak);
        return e;
    }

    /// <summary>Uploads (or, with an existing id, updates) a rumble effect; returns its id, −1 on failure.</summary>
    public static short UploadRumble(SafeFileHandle handle, short id, ushort strong, ushort weak, ushort lengthMs)
    {
        var effect = RumbleEffect(id, strong, weak, lengthMs);
        var fd = (int)handle.DangerousGetHandle();
        if (ioctl(fd, Ioc(IocWrite, 0x80, (uint)effect.Length), effect) < 0) return -1; // EVIOCSFF
        return BitConverter.ToInt16(effect, 2);
    }

    /// <summary>Writes one struct input_event (time 0), e.g. EV_FF to start or stop an effect.</summary>
    public static bool WriteEvent(SafeFileHandle handle, int type, int code, int value)
    {
        var e = new byte[EventSize];
        var o = e.Length - 8;
        BitConverter.TryWriteBytes(e.AsSpan(o), (ushort)type);
        BitConverter.TryWriteBytes(e.AsSpan(o + 2), (ushort)code);
        BitConverter.TryWriteBytes(e.AsSpan(o + 4), value);
        return write((int)handle.DangerousGetHandle(), e, e.Length) == e.Length;
    }

    public static DeviceInfo Describe(string path, SafeFileHandle handle)
    {
        var name = IoctlString(handle, 0x06);  // EVIOCGNAME
        var uniq = IoctlString(handle, 0x08);  // EVIOCGUNIQ
        var id = IoctlRead(handle, 0x02, 8);   // EVIOCGID: bustype, vendor, product, version
        var props = IoctlRead(handle, 0x09, 8); // EVIOCGPROP
        var absBits = IoctlRead(handle, 0x20 + EV_ABS, (ABS_MAX + 8) / 8);
        var keyBits = IoctlRead(handle, 0x20 + EV_KEY, (KEY_MAX + 8) / 8);

        var axes = new Dictionary<int, AbsInfo>();
        for (var code = 0; code <= ABS_MAX; code++)
        {
            if (!BitSet(absBits, code)) continue;
            var info = IoctlRead(handle, (uint)(0x40 + code), 24); // EVIOCGABS: struct input_absinfo
            if (info == null) continue;
            axes[code] = new AbsInfo(BitConverter.ToInt32(info, 0), BitConverter.ToInt32(info, 4), BitConverter.ToInt32(info, 8));
        }
        var keys = new List<int>();
        for (var code = 0; code <= KEY_MAX; code++)
            if (BitSet(keyBits, code)) keys.Add(code);

        return new DeviceInfo
        {
            Path = path,
            Name = name.Length > 0 ? name : System.IO.Path.GetFileName(path),
            Uniq = uniq,
            Vendor = id != null ? BitConverter.ToUInt16(id, 2) : (ushort)0,
            Product = id != null ? BitConverter.ToUInt16(id, 4) : (ushort)0,
            Axes = axes,
            Keys = keys,
            IsGameController = IsGameController(axes.Keys, keys, props),
        };
    }

    /// <summary>
    /// A gamepad or joystick: has joystick/gamepad buttons, or a stick (ABS_X) and is not a
    /// touchpad, mouse or motion sensor.
    /// </summary>
    public static bool IsGameController(IEnumerable<int> axes, IEnumerable<int> keys, byte[]? props)
    {
        if (BitSet(props, INPUT_PROP_ACCELEROMETER) || BitSet(props, INPUT_PROP_POINTER) || BitSet(props, INPUT_PROP_BUTTONPAD))
            return false;
        if (keys.Any(k => k >= BTN_JOYSTICK && k <= BTN_THUMBR)) return true;
        return axes.Contains(0x00);
    }

    /// <summary>Axis value normalized: triggers (min ≥ 0) to 0…1, everything else to −1…1 (T11).</summary>
    public static double Normalize(int code, AbsInfo info, int raw)
    {
        if (info.Maximum <= info.Minimum) return 0;
        var t = Math.Clamp((raw - (double)info.Minimum) / (info.Maximum - (double)info.Minimum), 0, 1);
        if (info.Minimum >= 0 && TriggerAxes.Contains(code)) return t;
        return t * 2 - 1;
    }

    /// <summary>Type, code and value of one struct input_event.</summary>
    public static (int Type, int Code, int Value) ParseEvent(ReadOnlySpan<byte> e)
    {
        var o = e.Length - 8;
        return (BitConverter.ToUInt16(e[o..]), BitConverter.ToUInt16(e[(o + 2)..]), BitConverter.ToInt32(e[(o + 4)..]));
    }

    private static readonly Dictionary<int, string> AxisNames = new()
    {
        [0x00] = "ABS_X", [0x01] = "ABS_Y", [0x02] = "ABS_Z", [0x03] = "ABS_RX", [0x04] = "ABS_RY", [0x05] = "ABS_RZ",
        [0x06] = "ABS_THROTTLE", [0x07] = "ABS_RUDDER", [0x08] = "ABS_WHEEL", [0x09] = "ABS_GAS", [0x0a] = "ABS_BRAKE",
        [0x10] = "ABS_HAT0X", [0x11] = "ABS_HAT0Y", [0x12] = "ABS_HAT1X", [0x13] = "ABS_HAT1Y",
    };

    private static readonly Dictionary<int, string> KeyNames = new()
    {
        [0x120] = "BTN_TRIGGER", [0x121] = "BTN_THUMB", [0x122] = "BTN_THUMB2", [0x123] = "BTN_TOP", [0x124] = "BTN_TOP2",
        [0x125] = "BTN_PINKIE", [0x126] = "BTN_BASE", [0x127] = "BTN_BASE2", [0x128] = "BTN_BASE3", [0x129] = "BTN_BASE4",
        [0x12a] = "BTN_BASE5", [0x12b] = "BTN_BASE6",
        [0x130] = "BTN_SOUTH", [0x131] = "BTN_EAST", [0x132] = "BTN_C", [0x133] = "BTN_NORTH", [0x134] = "BTN_WEST",
        [0x135] = "BTN_Z", [0x136] = "BTN_TL", [0x137] = "BTN_TR", [0x138] = "BTN_TL2", [0x139] = "BTN_TR2",
        [0x13a] = "BTN_SELECT", [0x13b] = "BTN_START", [0x13c] = "BTN_MODE", [0x13d] = "BTN_THUMBL", [0x13e] = "BTN_THUMBR",
        [0x220] = "BTN_DPAD_UP", [0x221] = "BTN_DPAD_DOWN", [0x222] = "BTN_DPAD_LEFT", [0x223] = "BTN_DPAD_RIGHT",
    };

    public static string AxisName(int code) => AxisNames.TryGetValue(code, out var n) ? n : $"ABS_0x{code:x2}";
    public static string KeyName(int code) => KeyNames.TryGetValue(code, out var n) ? n : code >= BTN_MISC ? $"BTN_0x{code:x3}" : $"KEY_{code}";
}
