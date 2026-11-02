using SignalRC.Onboard.Hardware.Lidar;

namespace SignalRC.Onboard.Telemetry.LidarGrid;

/// <summary>
/// One reduced revolution: 96 angle cells × 5 distance zones, nearest group
/// distance in millimetres, <see cref="Empty"/> where nothing is. The field
/// index is <c>cell · 5 + zone</c> (Shared/Overlay/lidar/README.md §4).
/// </summary>
public sealed class LidarGrid
{
    public const int Cells = 96;
    public const int Zones = LidarGridOptions.ZoneCount;
    public const int Fields = Cells * Zones;
    public const double CellDegrees = 360.0 / Cells; // 3.75
    public const ushort Empty = 0xFFFF;

    public ushort[] Mm { get; } = CreateEmpty();
    public bool Complete { get; init; }

    public ushort this[int cell, int zone] => Mm[cell * Zones + zone];

    public int Occupied => Mm.Count(v => v != Empty);

    private static ushort[] CreateEmpty()
    {
        var mm = new ushort[Fields];
        Array.Fill(mm, Empty);
        return mm;
    }
}

/// <summary>
/// Groups and grid from a single raw revolution (lidar/README.md §2–§4).
/// Groups are found on the whole revolution first, so neither 0°/360° nor
/// cell borders split them; only then are their points binned.
/// </summary>
public static class LidarGridBuilder
{
    private const int N = LidarProtocol.PointsPerRevolution;
    private static readonly double CosStep = Math.Cos(LidarProtocol.DegreesPerPoint * Math.PI / 180.0);

    public static LidarGrid Build(LidarScan raw, LidarGridOptions o) => Build(raw.DistanceMm, raw.Complete, o);

    public static LidarGrid Build(ReadOnlySpan<int> distanceMm, bool complete, LidarGridOptions o)
    {
        if (distanceMm.Length != N) throw new ArgumentException($"expected {N} slots", nameof(distanceMm));
        var grid = new LidarGrid { Complete = complete };

        // linked[i]: i and its clockwise-next slot belong to the same chain.
        Span<bool> linked = stackalloc bool[N];
        var allLinked = true;
        var maxSq = (double)o.NeighborMaxMm * o.NeighborMaxMm;
        for (var i = 0; i < N; i++)
        {
            var next = i + 1 == N ? 0 : i + 1;
            linked[i] = Usable(distanceMm[i]) && Usable(distanceMm[next]) && Linked(distanceMm[i], distanceMm[next], maxSq);
            allLinked &= linked[i];
        }

        if (allLinked)
        {
            if (N >= o.MinGroupPoints) Bin(grid, distanceMm, 0, N, o);
            return grid;
        }

        // Start right after a break so no chain is cut at the array end.
        var start = 0;
        while (linked[(start + N - 1) % N]) start++;

        var first = 0;
        var length = 0;
        for (var j = 0; j < N; j++)
        {
            var i = (start + j) % N;
            if (Usable(distanceMm[i]))
            {
                if (length == 0) first = i;
                length++;
            }
            if (!linked[i])
            {
                if (length >= o.MinGroupPoints) Bin(grid, distanceMm, first, length, o);
                length = 0;
            }
        }
        return grid;
    }

    public static bool Usable(int mm) => mm > 0 && mm != LidarScan.Missing && mm < LidarProtocol.NoReturnThresholdMm;

    /// <summary>Top-view distance of two neighbouring returns within the limit (law of cosines).</summary>
    private static bool Linked(double r1, double r2, double maxSq) =>
        r1 * r1 + r2 * r2 - 2 * r1 * r2 * CosStep <= maxSq;

    private static void Bin(LidarGrid grid, ReadOnlySpan<int> distanceMm, int first, int count, LidarGridOptions o)
    {
        for (var j = 0; j < count; j++)
        {
            var i = (first + j) % N;
            var mm = distanceMm[i];
            var zone = Zone(mm, o.ZoneLimitsMm);
            if (zone < 0) continue;
            var field = CellOf(i, o) * LidarGrid.Zones + zone;
            if (mm < grid.Mm[field]) grid.Mm[field] = (ushort)mm;
        }
    }

    private static int Zone(int mm, int[] limits)
    {
        for (var z = 0; z < limits.Length; z++)
        {
            if (mm <= limits[z]) return z;
        }
        return -1;
    }

    /// <summary>Cell of a raw index after direction and mounting correction; a border belongs to the higher cell.</summary>
    public static int CellOf(int index, LidarGridOptions o)
    {
        var raw = index * LidarProtocol.DegreesPerPoint;
        var a = ((o.ScannerClockwise ? raw : -raw) + o.MountYawDeg) % 360.0;
        if (a < 0) a += 360.0;
        if (a >= 360.0) a -= 360.0;
        return Math.Min(LidarGrid.Cells - 1, (int)Math.Floor(a / LidarGrid.CellDegrees));
    }
}
