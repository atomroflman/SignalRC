using SignalRC.Onboard.Hardware.Lidar;

namespace SignalRC.Onboard.Telemetry.LidarGrid;

/// <summary>Source options of the LiDAR grid channel (Shared/Overlay/lidar/README.md §1).</summary>
public sealed record LidarGridOptions
{
    public const int ZoneCount = 5;
    public const int MaxZoneLimitMm = 65534;
    public static IReadOnlyList<int> DefaultZoneLimitsMm { get; } = [500, 1000, 2000, 3000, 5000];

    /// <summary>Mounting offset, clockwise positive (D41).</summary>
    public double MountYawDeg { get; init; }

    /// <summary>Upper bounds of the five zones, strictly increasing.</summary>
    public int[] ZoneLimitsMm { get; init; } = [.. DefaultZoneLimitsMm];

    /// <summary>Spatial neighbour distance, inclusive.</summary>
    public int NeighborMaxMm { get; init; } = 50;

    public int MinGroupPoints { get; init; } = 3;

    /// <summary>
    /// Whether raw indices count clockwise seen from above. Provisional until
    /// the capture of D58; a property of the scanner, so it is a source option
    /// rather than a constant.
    /// </summary>
    public bool ScannerClockwise { get; init; } = true;

    public static LidarGridOptions Default { get; } = new();

    /// <summary>Problems that make the options unusable; empty when valid.</summary>
    public IReadOnlyList<string> Validate()
    {
        var errors = new List<string>();
        if (!double.IsFinite(MountYawDeg)) errors.Add("mountYawDeg must be a finite number");
        if (ZoneLimitsMm is not { Length: ZoneCount })
        {
            errors.Add($"zoneLimitsMm needs exactly {ZoneCount} values");
        }
        else
        {
            if (ZoneLimitsMm[0] <= 0) errors.Add("zoneLimitsMm must be positive");
            for (var z = 1; z < ZoneCount; z++)
            {
                if (ZoneLimitsMm[z] <= ZoneLimitsMm[z - 1]) errors.Add("zoneLimitsMm must be strictly increasing");
            }
            if (ZoneLimitsMm[^1] > MaxZoneLimitMm) errors.Add($"zoneLimitsMm must not exceed {MaxZoneLimitMm}");
        }
        if (NeighborMaxMm <= 0) errors.Add("neighborMaxMm must be positive");
        if (MinGroupPoints < 1 || MinGroupPoints > LidarProtocol.PointsPerRevolution)
        {
            errors.Add($"minGroupPoints must be between 1 and {LidarProtocol.PointsPerRevolution}");
        }
        return errors.Distinct().ToList();
    }
}
