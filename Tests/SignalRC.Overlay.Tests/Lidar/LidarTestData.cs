using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry.LidarGrid;

namespace SignalRC.Overlay.Tests.Lidar;

internal static class LidarTestData
{
    public const int N = LidarProtocol.PointsPerRevolution;

    /// <summary>A revolution with the given slots set, all others Missing.</summary>
    public static int[] Points(params (int Index, int Mm)[] points)
    {
        var d = new int[N];
        Array.Fill(d, LidarScan.Missing);
        foreach (var (i, mm) in points) d[i] = mm;
        return d;
    }

    public static int[] Run(int first, int count, int mm, int[]? into = null)
    {
        var d = into ?? Points();
        for (var j = 0; j < count; j++) d[(first + j) % N] = mm;
        return d;
    }

    public static LidarScan Scan(int[] distances, uint sequence, bool complete = true, DateTime? receivedUtc = null)
    {
        var scan = new LidarScan
        {
            Sequence = sequence,
            Complete = complete,
            ReceivedUtc = receivedUtc ?? DateTime.UtcNow,
            UsableCount = distances.Count(LidarGridBuilder.Usable),
        };
        Array.Copy(distances, scan.DistanceMm, N);
        return scan;
    }

    /// <summary>Non-empty fields as (cell, zone, mm), ordered by field index.</summary>
    public static List<(int Cell, int Zone, int Mm)> Fields(LidarGrid grid)
    {
        var fields = new List<(int, int, int)>();
        for (var i = 0; i < LidarGrid.Fields; i++)
        {
            if (grid.Mm[i] != LidarGrid.Empty) fields.Add((i / LidarGrid.Zones, i % LidarGrid.Zones, grid.Mm[i]));
        }
        return fields;
    }

    public static LidarHealth Healthy => new() { PortOpen = true, Spinning = true, ScanAgeSeconds = 0.05 };
}

/// <summary>Test double for <see cref="ILidarSource"/> (modules/README.md: FakeLidarSource).</summary>
public sealed class FakeLidarSource : ILidarSource, IModuleManager
{
    public LidarScan? LatestScan { get; set; }
    public LidarScan? LatestRawScan { get; set; }
    public LidarHealth Health { get; set; } = new();

    public T GetModule<T>(int address) where T : class, IModule => (this as T)!;
}

public sealed class FakeModuleFactory(IModuleManager manager) : IModuleManagerFactory
{
    public IModuleManager Create(string name) => manager;
}
