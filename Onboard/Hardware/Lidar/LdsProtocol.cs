namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Wire format of the FM1828 laser distance sensor - the LDS unit from Ecovacs
/// Deebot vacuums, reused here as a 360 degree scanner.
///
/// 115200 8N1. 22-byte packets:
///
///     0   0xFA
///     1   index, 0xA0..0xF9 - 90 packets, 4 samples each, 360 a revolution
///     2-3 rotation speed, uint16 little endian
///     4-19 four samples of four bytes: distance word then strength word
///     20-21 checksum, uint16 little endian
///
/// A sample's distance word carries flags in its top two bits: bit 15 means no
/// valid return, bit 14 means the return was weak. The low 14 bits are
/// millimetres. angle = (index - 0xA0) * 4 + sample, in degrees.
///
/// Two details differ from the Neato XV-11 family this is usually lumped in
/// with, and getting either wrong produces a decoder that almost works:
///
///   - The checksum is a plain sum of bytes 0..19, not the XV-11's word based
///     algorithm.
///   - speed_raw / 100 is RPM here, not the XV-11's / 64. The community
///     measurement that established this counted revolutions from index wraps:
///     4.97 rev/s, so 298 RPM, with speed_raw reading 29946. Dividing by 64
///     would have claimed 468.
///
/// No manufacturer datasheet exists. Sources in the firmware repository's
/// LINKS.md.
/// </summary>
public static class LdsProtocol
{
    public const int PacketLength = 22;
    public const byte StartByte = 0xFA;
    public const byte IndexFirst = 0xA0;
    public const byte IndexLast = 0xF9;

    public const int PacketsPerRevolution = 90;
    public const int SamplesPerPacket = 4;
    public const int SamplesPerRevolution = PacketsPerRevolution * SamplesPerPacket; // 360

    /// <summary>Bit 15 of a distance word: the sample is not a measurement.</summary>
    public const ushort NoReturnFlag = 0x8000;
    /// <summary>Bit 14: there was a return, but a weak one.</summary>
    public const ushort WeakSignalFlag = 0x4000;
    public const ushort DistanceMask = 0x3FFF;

    /// <summary>What the module reports, divided by 100. See the class remarks:
    /// this is not the XV-11 scaling.</summary>
    public const double SpeedRawToRpm = 1.0 / 100.0;

    /// <summary>Wakes the motor. The module then spins and streams on its own.</summary>
    public static readonly byte[] StartCommand = "startlds$"u8.ToArray();

    public static bool IsValidIndex(byte index) => index >= IndexFirst && index <= IndexLast;

    /// <summary>Plain sum of the first 20 bytes, little endian in the last two.</summary>
    public static bool ChecksumOk(ReadOnlySpan<byte> packet)
    {
        if (packet.Length < PacketLength) return false;
        var sum = 0;
        for (var i = 0; i < PacketLength - 2; i++) sum += packet[i];
        var expected = (ushort)(packet[PacketLength - 2] | (packet[PacketLength - 1] << 8));
        return (ushort)(sum & 0xFFFF) == expected;
    }
}

/// <summary>One measurement.</summary>
public readonly record struct LdsSample(int AngleDegrees, int DistanceMm, int Strength, bool Valid, bool Weak);

/// <summary>
/// One revolution. Indexed by degree, so a missing packet leaves its four
/// degrees at <see cref="Missing"/> rather than silently shifting everything
/// that follows - which is what an angle-free list of points would do.
/// </summary>
public sealed class LdsScan
{
    /// <summary>Distance marker for a degree that carried no usable value,
    /// whether the packet was lost or the sensor reported no return. Zero
    /// would read as "something is touching the sensor".</summary>
    public const int Missing = -1;

    public readonly int[] DistanceMm = new int[LdsProtocol.SamplesPerRevolution];
    public readonly int[] Strength = new int[LdsProtocol.SamplesPerRevolution];

    public double Rpm { get; internal set; }
    /// <summary>Degrees that carried a usable measurement.</summary>
    public int ValidCount { get; internal set; }
    /// <summary>Degrees that did not: 360 minus <see cref="ValidCount"/>.
    /// Carried on the scan rather than only on the framer so that a scan is
    /// self-describing - a caller holding one does not have to go back and ask
    /// the framer what state it was in at the time.</summary>
    public int Gaps => LdsProtocol.SamplesPerRevolution - ValidCount;
    public DateTime CompletedUtc { get; internal set; }

    internal void Clear()
    {
        Array.Fill(DistanceMm, Missing);
        Array.Fill(Strength, 0);
        ValidCount = 0;
    }

    public LdsScan() => Clear();

    /// <summary>Independent copy. The framer hands one of these out per
    /// revolution rather than its working buffer: a reused mutable object
    /// passed to a callback is a trap, and the first test written against this
    /// decoder fell into it within a minute. Two arrays of 360 ints five times
    /// a second is not worth defending against.</summary>
    internal LdsScan Snapshot()
    {
        var copy = new LdsScan
        {
            Rpm = Rpm,
            ValidCount = ValidCount,
            CompletedUtc = CompletedUtc,
        };
        Array.Copy(DistanceMm, copy.DistanceMm, DistanceMm.Length);
        Array.Copy(Strength, copy.Strength, Strength.Length);
        return copy;
    }

    /// <summary>
    /// Smallest distance in each of <paramref name="sectors"/> equal slices,
    /// for telemetry. The minimum rather than a mean on purpose: what matters
    /// about a direction is the nearest thing in it, and averaging a wall at
    /// 3 m with a post at 0.4 m reports 1.7 m, where there is nothing.
    /// A sector with no usable sample comes back as <see cref="Missing"/>.
    /// </summary>
    public int[] SectorMinima(int sectors)
    {
        if (sectors < 1) sectors = 1;
        if (sectors > LdsProtocol.SamplesPerRevolution) sectors = LdsProtocol.SamplesPerRevolution;
        var result = new int[sectors];
        Array.Fill(result, Missing);
        for (var i = 0; i < LdsProtocol.SamplesPerRevolution; i++)
        {
            var d = DistanceMm[i];
            if (d == Missing) continue;
            var s = i * sectors / LdsProtocol.SamplesPerRevolution;
            if (result[s] == Missing || d < result[s]) result[s] = d;
        }
        return result;
    }
}
