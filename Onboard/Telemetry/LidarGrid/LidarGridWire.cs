using System.Buffers.Binary;

namespace SignalRC.Onboard.Telemetry.LidarGrid;

/// <summary>
/// Sample value of the grid channel (lidar/README.md §5, D62):
/// <c>&lt;version&gt;&lt;complete&gt;&lt;s|d&gt;:&lt;base64&gt;</c>, centimetres as
/// uint16 little endian. Sparse lists (index, cm) pairs of occupied fields,
/// dense all 480 values; sparse is used up to <see cref="MaxSparseFields"/>.
/// </summary>
public static class LidarGridWire
{
    public const char Version = '1';
    public const int MaxSparseFields = 239;
    public const int DeadbandCm = 2;

    public static ushort ToCm(ushort mm) => mm == LidarGrid.Empty ? LidarGrid.Empty : (ushort)((mm + 5) / 10);

    public static ushort[] ToCm(LidarGrid grid)
    {
        var cm = new ushort[LidarGrid.Fields];
        for (var i = 0; i < cm.Length; i++) cm[i] = ToCm(grid.Mm[i]);
        return cm;
    }

    public static string Encode(LidarGrid grid) => Encode(ToCm(grid), grid.Complete);

    public static string Encode(ReadOnlySpan<ushort> cm, bool complete)
    {
        if (cm.Length != LidarGrid.Fields) throw new ArgumentException($"expected {LidarGrid.Fields} fields", nameof(cm));
        var occupied = 0;
        foreach (var v in cm) if (v != LidarGrid.Empty) occupied++;

        var sparse = occupied <= MaxSparseFields;
        var bytes = new byte[sparse ? occupied * 4 : LidarGrid.Fields * 2];
        if (sparse)
        {
            var o = 0;
            for (var i = 0; i < cm.Length; i++)
            {
                if (cm[i] == LidarGrid.Empty) continue;
                BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(o, 2), (ushort)i);
                BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(o + 2, 2), cm[i]);
                o += 4;
            }
        }
        else
        {
            for (var i = 0; i < cm.Length; i++) BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(i * 2, 2), cm[i]);
        }
        return string.Concat(Version, complete ? '1' : '0', sparse ? 's' : 'd', ':', Convert.ToBase64String(bytes));
    }

    /// <summary>Parses a value back into 480 centimetre fields; false on anything malformed.</summary>
    public static bool TryDecode(string? value, out ushort[] cm, out bool complete)
    {
        cm = new ushort[LidarGrid.Fields];
        Array.Fill(cm, LidarGrid.Empty);
        complete = false;
        if (value is not { Length: >= 4 } || value[0] != Version || value[3] != ':' || value[1] is not ('0' or '1')) return false;
        complete = value[1] == '1';
        byte[] bytes;
        try { bytes = Convert.FromBase64String(value[4..]); }
        catch (FormatException) { return false; }

        switch (value[2])
        {
            case 'd':
                if (bytes.Length != LidarGrid.Fields * 2) return false;
                for (var i = 0; i < cm.Length; i++) cm[i] = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(i * 2, 2));
                return true;
            case 's':
                if (bytes.Length % 4 != 0) return false;
                var last = -1;
                for (var o = 0; o < bytes.Length; o += 4)
                {
                    int index = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(o, 2));
                    if (index <= last || index >= LidarGrid.Fields) return false;
                    cm[index] = BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(o + 2, 2));
                    last = index;
                }
                return true;
            default:
                return false;
        }
    }

    /// <summary>
    /// Deadband against the last sent grid: same occupied fields, every value
    /// within <see cref="DeadbandCm"/>, same completeness. Then only a
    /// confirmation goes out.
    /// </summary>
    public static bool WithinDeadband(ReadOnlySpan<ushort> sentCm, bool sentComplete, ReadOnlySpan<ushort> nextCm, bool nextComplete)
    {
        if (sentComplete != nextComplete || sentCm.Length != nextCm.Length) return false;
        for (var i = 0; i < sentCm.Length; i++)
        {
            var a = sentCm[i];
            var b = nextCm[i];
            if ((a == LidarGrid.Empty) != (b == LidarGrid.Empty)) return false;
            if (Math.Abs(a - b) > DeadbandCm) return false;
        }
        return true;
    }
}
