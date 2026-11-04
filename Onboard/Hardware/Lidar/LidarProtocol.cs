namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Link protocol between the RP2040 running <c>firmware/pico-usb</c> and this
/// host. Specified in the lidar-i2c repository, <c>docs/pico-usb.md</c>; the
/// Pico side is <c>firmware/pico-usb/src/proto.h</c> and the reference host
/// implementation is <c>python/fm1828/link.py</c>. All three have to agree.
///
/// The sensor itself is an Ecovacs FM1828 and speaks a different, 62-byte
/// frame format on its UART. The Pico parses that, assembles whole
/// revolutions and sends them on - the host never sees a sensor frame. That
/// is why the earlier decoder here, written for the raw format, was wrong for
/// this build: it was decoding a stream nothing on this vehicle produces.
///
///     'L' 'D' | type | uint16 length | payload | uint16 CRC
///
/// The CRC covers the type and the length as well as the payload, so a
/// corrupted length cannot be mistaken for a valid header. A receiver that
/// loses sync scans forward for the LD pair and checks the CRC; a false
/// positive costs one byte of resynchronisation.
/// </summary>
public static class LidarProtocol
{
    public const byte Sync0 = (byte)'L';
    public const byte Sync1 = (byte)'D';
    public const int HeaderLength = 5;   // sync, sync, type, length
    public const int CrcLength = 2;
    public const int MaxPayload = 3072;

    public const byte MsgScan = 0x01;
    public const byte MsgStatus = 0x02;
    public const byte MsgLog = 0x03;

    /// <summary>Slots per revolution. The sensor numbers its frames 0xA0..0xF9
    /// and each carries 16 points, so every point has a fixed slot and the
    /// angle is implicit - nothing about angles travels on the wire.</summary>
    public const int PointsPerRevolution = 1440;
    public const double DegreesPerPoint = 360.0 / PointsPerRevolution; // 0.25

    public const int ScanPayloadLength = 16 + PointsPerRevolution * 2; // 2896
    public const int StatusPayloadLength = 40;

    /// <summary>Raw speed divided by this is RPM. Confirmed twice over on a
    /// real capture: 29944 gives 299.4 RPM, and the scan timestamps are 200 ms
    /// apart, which is the same thing.</summary>
    public const double SpeedRawToRpm = 1.0 / 100.0;

    /// <summary>The sensor reports no return as 0 or as anything from 32000 up.
    /// The Pico normalises to 0, but a value this large is treated as absent
    /// here too rather than as an obstacle 32 metres away.</summary>
    public const int NoReturnThresholdMm = 32000;

    /// <summary>
    /// CRC-16/CCITT-FALSE: polynomial 0x1021, init 0xFFFF, no reflection, no
    /// final xor. The check value for "123456789" is 0x29B1, which both the
    /// firmware and the Python host assert at startup - worth keeping as a
    /// test here too, because a CRC that is subtly wrong rejects everything
    /// and looks exactly like a broken cable.
    /// </summary>
    public static ushort Crc16(ReadOnlySpan<byte> data)
    {
        var crc = 0xFFFF;
        foreach (var b in data)
        {
            crc ^= b << 8;
            for (var i = 0; i < 8; i++)
            {
                crc = (crc & 0x8000) != 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
            }
        }
        return (ushort)crc;
    }

    // --- commands, plain ASCII lines ---------------------------------------
    // The link can be driven by hand from any terminal while the binary stream
    // runs the other way, which is how the protocol was worked out in the
    // first place.

    /// <summary>Sends "$" now and "startlds$" two seconds later.</summary>
    public const string CommandStart = "START";
    /// <summary>The sensor then refuses to start until its power is cycled.</summary>
    public const string CommandStop = "STOP";
    /// <summary>Power off 1.5 s, on, settle, then start. The only way back
    /// from a stopped sensor.</summary>
    public const string CommandRestart = "RESTART";
    public const string CommandStatus = "STATUS";

    public enum PicoState : byte
    {
        PowerOff = 0,
        Booting = 1,
        /// <summary>Idle frames arriving, motor stopped.</summary>
        Idle = 2,
        Starting = 3,
        Spinning = 4,
        /// <summary>Stopped on command; refuses a start until power is cycled.</summary>
        Stopped = 5,
    }

    public static string Describe(PicoState s) => s switch
    {
        PicoState.PowerOff => "power off",
        PicoState.Booting => "booting or silent",
        PicoState.Idle => "idle, motor stopped",
        PicoState.Starting => "starting",
        PicoState.Spinning => "spinning",
        PicoState.Stopped => "stopped, needs a power cycle",
        _ => $"unknown ({(byte)s})",
    };
}

/// <summary>One revolution, as the Pico assembled it.</summary>
public sealed class LidarScan
{
    /// <summary>Marker for a slot with no usable value. Zero would read as
    /// something touching the sensor; this is the absence of an obstacle.</summary>
    public const int Missing = -1;

    public readonly int[] DistanceMm = new int[LidarProtocol.PointsPerRevolution];

    /// <summary>Revolution counter since the Pico booted. Gaps mean the host
    /// was not reading fast enough - the Pico says so in its status too.</summary>
    public uint Sequence { get; internal set; }
    public uint PicoTimeMs { get; internal set; }
    public double Rpm { get; internal set; }
    /// <summary>Non-zero entries as the Pico counted them, before this class
    /// applied its own range check.</summary>
    public int PointsValid { get; internal set; }
    /// <summary>Sensor frames received for this revolution; 90 is complete.</summary>
    public int Frames { get; internal set; }
    public int MissingFrames { get; internal set; }
    public bool Complete { get; internal set; }
    public DateTime ReceivedUtc { get; internal set; }

    /// <summary>Slots carrying a usable distance after the range check.</summary>
    public int UsableCount { get; internal set; }
    public int Gaps => LidarProtocol.PointsPerRevolution - UsableCount;

    public LidarScan() => Array.Fill(DistanceMm, Missing);

    public static double AngleOf(int index) => index * LidarProtocol.DegreesPerPoint;

    internal LidarScan Snapshot()
    {
        var copy = new LidarScan
        {
            Sequence = Sequence,
            PicoTimeMs = PicoTimeMs,
            Rpm = Rpm,
            PointsValid = PointsValid,
            Frames = Frames,
            MissingFrames = MissingFrames,
            Complete = Complete,
            ReceivedUtc = ReceivedUtc,
            UsableCount = UsableCount,
        };
        Array.Copy(DistanceMm, copy.DistanceMm, DistanceMm.Length);
        return copy;
    }

    /// <summary>
    /// Smallest distance in each of <paramref name="sectors"/> equal slices.
    /// The minimum rather than a mean: what matters about a direction is the
    /// nearest thing in it, and averaging a wall at 3 m with a post at 0.4 m
    /// reports 1.7 m, where there is nothing. Empty sectors come back as
    /// <see cref="Missing"/>.
    /// </summary>
    public int[] SectorMinima(int sectors)
    {
        sectors = Math.Clamp(sectors, 1, LidarProtocol.PointsPerRevolution);
        var result = new int[sectors];
        Array.Fill(result, Missing);
        for (var i = 0; i < LidarProtocol.PointsPerRevolution; i++)
        {
            var d = DistanceMm[i];
            if (d == Missing) continue;
            var s = i * sectors / LidarProtocol.PointsPerRevolution;
            if (result[s] == Missing || d < result[s]) result[s] = d;
        }
        return result;
    }
}

/// <summary>The Pico's own view of the link and the sensor, once a second.</summary>
public sealed record LidarStatus
{
    public uint UptimeMs { get; init; }
    public uint BytesRx { get; init; }
    public uint FramesOk { get; init; }
    /// <summary>Sensor frames that failed the sensor's own checksum.</summary>
    public uint FramesBad { get; init; }
    public uint IdleFrames { get; init; }
    public uint Scans { get; init; }
    /// <summary>Revolutions the Pico threw away because this host was not
    /// reading. A climbing number here is our fault, not the sensor's.</summary>
    public uint ScansDropped { get; init; }
    public uint UartOverruns { get; init; }
    public int SpeedRaw { get; init; }
    public int IdleMm { get; init; }
    public LidarProtocol.PicoState State { get; init; }
    public bool PowerOn { get; init; }
    /// <summary>The sensor answered "$" with 0x21 at least once.</summary>
    public bool AckSeen { get; init; }
    public byte ProtocolVersion { get; init; }
}
