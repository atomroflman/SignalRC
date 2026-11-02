using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry.LidarGrid;
using static SignalRC.Overlay.Tests.Lidar.LidarTestData;

namespace SignalRC.Overlay.Tests.Lidar;

// Acceptance cases of AP04 beyond the shared fixture, all without hardware.
public class LidarGridBuilderTests
{
    private static readonly LidarGridOptions Defaults = LidarGridOptions.Default;

    private static List<(int Cell, int Zone, int Mm)> Build(int[] d, LidarGridOptions? o = null, bool complete = true) =>
        Fields(LidarGridBuilder.Build(d, complete, o ?? Defaults));

    [Fact]
    public void OneTwoAndThreePoints()
    {
        Assert.Empty(Build(Points((500, 1000))));
        Assert.Empty(Build(Points((500, 1000), (501, 1000))));
        Assert.Equal([(33, 1, 1000)], Build(Points((500, 1000), (501, 1000), (502, 1000))));
        // The minimum group size is a source option.
        Assert.Equal([(33, 1, 1000)], Build(Points((500, 1000)), Defaults with { MinGroupPoints = 1 }));
    }

    [Fact]
    public void NeighbourLimitIsInclusiveAndSpatial()
    {
        // 1000 → 1049 mm is 49.2 mm apart in top view: linked at 50, not at 49.
        var d = Points((10, 1000), (11, 1000), (12, 1049));
        Assert.Equal([(0, 1, 1000), (0, 2, 1049)], Build(d));
        Assert.Empty(Build(d, Defaults with { NeighborMaxMm = 49 }));

        // Same radius, only the chord counts: 2·r·sin(0.125°) crosses 50 mm
        // between 11459 mm (49.998) and 11460 mm (50.003). A radial difference
        // check would link both.
        Assert.NotEmpty(Build(Run(100, 3, 11459), Defaults with { ZoneLimitsMm = [500, 1000, 2000, 3000, 12000] }));
        Assert.Empty(Build(Run(100, 3, 11460), Defaults with { ZoneLimitsMm = [500, 1000, 2000, 3000, 12000] }));
    }

    [Fact]
    public void DistanceJumpSplitsGroups()
    {
        // Ten points of a near post, then a wall behind it in the same cell.
        var d = Run(390, 5, 1000);
        Run(395, 5, 1500, d);
        Assert.Equal([(26, 1, 1000), (26, 2, 1500)], Build(d));

        // A jump that leaves only two points behind does not form a group there.
        var e = Run(390, 5, 1000);
        Run(395, 2, 1500, e);
        Assert.Equal([(26, 1, 1000)], Build(e));
    }

    [Fact]
    public void GapsAndUnusableValuesBreakChains()
    {
        foreach (var bad in new[] { 0, LidarScan.Missing, LidarProtocol.NoReturnThresholdMm, 40000 })
        {
            var d = Points((20, 1000), (21, 1000), (22, bad), (23, 1000), (24, 1000));
            Assert.Empty(Build(d));
        }
        // Just below the no-return threshold is a measurement (beyond all zones by default).
        Assert.Equal([(1, 4, 31999)], Build(Run(20, 3, 31999), Defaults with { ZoneLimitsMm = [500, 1000, 2000, 3000, 65534], NeighborMaxMm = 200 }));
    }

    [Fact]
    public void WholeRevolutionLinkedIsOneGroup()
    {
        var all = Build(Run(0, N, 1200));
        Assert.Equal(96, all.Count);
        Assert.All(all, f => Assert.Equal((2, 1200), (f.Zone, f.Mm)));

        // With one gap the group wraps around 1439 → 0 and is still valid.
        var d = Run(0, N, 1200);
        d[700] = LidarScan.Missing;
        Assert.Equal(96, Build(d).Count);
    }

    [Fact]
    public void GroupOverWrapAndCellBorderIsDetectedBeforeBinning()
    {
        // Two points each side of 0° — neither side alone has three.
        Assert.Equal([(0, 1, 800), (95, 1, 800)], Build(Points((1438, 800), (1439, 800), (0, 800), (1, 800))));
        // Two points each side of the 3.75° border.
        Assert.Equal([(0, 2, 1500), (1, 2, 1500)], Build(Points((13, 1500), (14, 1500), (15, 1500), (16, 1500))));
    }

    [Fact]
    public void MountingCorrectionIsClockwisePositiveAndWraps()
    {
        var d = Points((0, 1000), (1, 1000), (2, 1000));
        Assert.Equal(24, Build(d, Defaults with { MountYawDeg = 90 }).Single().Cell);
        Assert.Equal(72, Build(d, Defaults with { MountYawDeg = -90 }).Single().Cell);
        Assert.Equal(1, Build(d, Defaults with { MountYawDeg = 365 }).Single().Cell);
        // A point exactly on a cell border belongs to the higher cell.
        Assert.Equal(1, LidarGridBuilder.CellOf(15, Defaults));
        Assert.Equal(0, LidarGridBuilder.CellOf(14, Defaults));
        Assert.Equal(1, LidarGridBuilder.CellOf(14, Defaults with { MountYawDeg = 0.25 }));
        Assert.Equal(0, LidarGridBuilder.CellOf(0, Defaults with { MountYawDeg = 360 }));
        Assert.Equal(95, LidarGridBuilder.CellOf(1439, Defaults));
    }

    [Fact]
    public void ScannerDirectionIsASourceOption()
    {
        // Counter-clockwise indices run from front to the left (D58 not yet decided).
        var ccw = Defaults with { ScannerClockwise = false };
        Assert.Equal(0, LidarGridBuilder.CellOf(0, ccw));
        Assert.Equal(95, LidarGridBuilder.CellOf(1, ccw));
        Assert.Equal(72, LidarGridBuilder.CellOf(360, ccw));
        Assert.Equal(24, LidarGridBuilder.CellOf(360, Defaults));
        Assert.Equal([(95, 1, 1000)], Build(Points((1, 1000), (2, 1000), (3, 1000)), ccw));
        // Mounting offset is applied after the direction.
        Assert.Equal(0, LidarGridBuilder.CellOf(360, ccw with { MountYawDeg = 90 }));
    }

    [Fact]
    public void ZoneEdgesAndCustomLimits()
    {
        Assert.Equal([(2, 0, 500), (2, 1, 501)], Build(Points((40, 500), (41, 501), (42, 502))));
        Assert.Equal([(13, 4, 4999)], Build(Points((200, 4999), (201, 5000), (202, 5001))));
        Assert.Equal([(13, 4, 5000)], Build(Points((200, 5000), (201, 5001), (202, 5002))));
        var custom = Defaults with { ZoneLimitsMm = [100, 200, 300, 400, 600] };
        Assert.Equal([(13, 4, 501)], Build(Run(200, 3, 501), custom));
        Assert.Empty(Build(Run(200, 3, 601), custom));
    }

    [Fact]
    public void SeveralGroupsInOneFieldKeepTheNearest()
    {
        // Three groups in cell 4, zone 3 and one in zone 2 of the same cell.
        var d = Run(60, 3, 2500);
        Run(64, 3, 2200, d);
        Run(68, 3, 2900, d);
        Run(72, 3, 1900, d);
        Assert.Equal([(4, 2, 1900), (4, 3, 2200)], Build(d));
    }

    [Fact]
    public void PartialScanKeepsGroupsAndFlagsTheGrid()
    {
        var d = Run(0, 720, 900);
        var grid = LidarGridBuilder.Build(d, complete: false, Defaults);
        Assert.False(grid.Complete);
        Assert.Equal(48, Fields(grid).Count);
        Assert.StartsWith("10s:", LidarGridWire.Encode(grid));
    }

    [Theory]
    [InlineData(new[] { 500, 1000, 2000, 3000 }, "exactly")]
    [InlineData(new[] { 500, 500, 2000, 3000, 5000 }, "increasing")]
    [InlineData(new[] { 0, 1000, 2000, 3000, 5000 }, "positive")]
    [InlineData(new[] { 500, 1000, 2000, 3000, 65535 }, "65534")]
    public void InvalidZoneLimitsAreRejected(int[] limits, string message)
    {
        Assert.Contains((Defaults with { ZoneLimitsMm = limits }).Validate(), e => e.Contains(message));
    }

    [Fact]
    public void OtherInvalidOptionsAreRejected()
    {
        Assert.NotEmpty((Defaults with { NeighborMaxMm = 0 }).Validate());
        Assert.NotEmpty((Defaults with { MinGroupPoints = 0 }).Validate());
        Assert.NotEmpty((Defaults with { MountYawDeg = double.NaN }).Validate());
        Assert.Empty((Defaults with { ZoneLimitsMm = [1, 2, 3, 4, 65534], MountYawDeg = -725.5 }).Validate());
    }

    [Fact]
    public void RealCaptureProducesCompactGrids()
    {
        var path = Path.Combine(Testing.Contracts.RepositoryRoot, "Onboard", "Hardware", "Lidar", "testdata", "pico-scan-10rev.bin");
        var scans = new List<LidarScan>();
        new LidarFramer().Push(File.ReadAllBytes(path), scans.Add);
        Assert.NotEmpty(scans);

        var watch = System.Diagnostics.Stopwatch.StartNew();
        foreach (var scan in scans)
        {
            var grid = LidarGridBuilder.Build(scan, Defaults);
            var value = LidarGridWire.Encode(grid);
            Assert.True(value.Length <= 4 + 1280, $"{value.Length} chars");
            Assert.True(LidarGridWire.TryDecode(value, out _, out var complete));
            Assert.Equal(scan.Complete, complete);
            // Every occupied field comes from a usable raw point.
            Assert.All(Fields(grid), f => Assert.Contains(f.Mm, scan.DistanceMm));
        }
        watch.Stop();
        // One build is well below the 200 ms scan period; generous bound for CI.
        Assert.True(watch.Elapsed.TotalMilliseconds / scans.Count < 20, $"{watch.Elapsed.TotalMilliseconds / scans.Count:0.0} ms per scan");
    }
}
