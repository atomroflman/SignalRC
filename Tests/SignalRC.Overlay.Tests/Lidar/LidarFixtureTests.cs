using System.Text.Json.Nodes;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Overlay.Tests.Testing;
using static SignalRC.Overlay.Tests.Lidar.LidarTestData;

namespace SignalRC.Overlay.Tests.Lidar;

// Runs the onboard grid producer against Shared/Overlay/fixtures/lidar/cases.json.
public class LidarFixtureTests
{
    private static readonly JsonObject Fixture = Contracts.ReadJson("fixtures/lidar/cases.json")!.AsObject();

    private static TheoryData<string> Ids(string section)
    {
        var data = new TheoryData<string>();
        foreach (var c in Fixture[section]!.AsArray()) data.Add(c!["id"]!.GetValue<string>());
        return data;
    }

    public static TheoryData<string> CaseIds() => Ids("cases");
    public static TheoryData<string> WireIds() => Ids("wire");
    public static TheoryData<string> DeadbandIds() => Ids("deadband");

    private static JsonNode Case(string section, string id) =>
        Fixture[section]!.AsArray().Single(x => x!["id"]!.GetValue<string>() == id)!;

    private static LidarGridOptions Options(JsonNode? overrides)
    {
        var d = Fixture["defaultOptions"]!;
        JsonNode Get(string key) => overrides?[key] ?? d[key]!;
        return new LidarGridOptions
        {
            MountYawDeg = Get("mountYawDeg").GetValue<double>(),
            ZoneLimitsMm = Get("zoneLimitsMm").AsArray().Select(v => v!.GetValue<int>()).ToArray(),
            NeighborMaxMm = Get("neighborMaxMm").GetValue<int>(),
            MinGroupPoints = Get("minGroupPoints").GetValue<int>(),
        };
    }

    private static List<(int Cell, int Zone, int Mm)> FieldList(JsonNode? list) =>
        list!.AsArray().Select(f => (f!["cell"]!.GetValue<int>(), f["zone"]!.GetValue<int>(), f["mm"]!.GetValue<int>()))
            .OrderBy(f => f.Item1 * 5 + f.Item2).ToList();

    private static LidarGrid GridOf(List<(int Cell, int Zone, int Mm)> fields, bool complete)
    {
        var grid = new LidarGrid { Complete = complete };
        foreach (var (cell, zone, mm) in fields) grid.Mm[cell * 5 + zone] = (ushort)mm;
        return grid;
    }

    [Fact]
    public void DefaultOptionsMatchTheContract()
    {
        var fixture = Options(null);
        Assert.Equal(fixture, LidarGridOptions.Default with { ZoneLimitsMm = fixture.ZoneLimitsMm });
        Assert.Equal(fixture.ZoneLimitsMm, LidarGridOptions.Default.ZoneLimitsMm);
        Assert.Empty(LidarGridOptions.Default.Validate());
    }

    [Theory]
    [MemberData(nameof(CaseIds))]
    public void GroupsAndGridMatchSharedFixture(string id)
    {
        var c = Case("cases", id);
        var points = c["points"]!.AsObject().Select(kv => (int.Parse(kv.Key), kv.Value!.GetValue<int>())).ToArray();
        var grid = LidarGridBuilder.Build(Points(points), complete: true, Options(c["options"]));
        Assert.Equal(FieldList(c["expect"]!["cells"]), Fields(grid));
    }

    [Theory]
    [MemberData(nameof(WireIds))]
    public void WireValueMatchesSharedFixture(string id)
    {
        var c = Case("wire", id);
        var complete = c["complete"]!.GetValue<bool>();
        var fields = FieldList(c["fields"]);
        var value = LidarGridWire.Encode(GridOf(fields, complete));
        Assert.Equal(c["value"]!.GetValue<string>(), value);

        Assert.True(LidarGridWire.TryDecode(value, out var cm, out var decodedComplete));
        Assert.Equal(complete, decodedComplete);
        var expectedCm = fields.Select(f => (f.Cell * 5 + f.Zone, (int)LidarGridWire.ToCm((ushort)f.Mm))).ToList();
        var actualCm = cm.Select((v, i) => (i, (int)v)).Where(x => x.Item2 != 0xFFFF).ToList();
        Assert.Equal(expectedCm, actualCm);
    }

    [Theory]
    [MemberData(nameof(DeadbandIds))]
    public void DeadbandMatchesSharedFixture(string id)
    {
        var c = Case("deadband", id);
        var sent = LidarGridWire.ToCm(GridOf(FieldList(c["previousSent"]), true));
        var next = LidarGridWire.ToCm(GridOf(FieldList(c["next"]), true));
        var touch = LidarGridWire.WithinDeadband(sent, true, next, true);
        Assert.Equal(c["expect"]!.GetValue<string>(), touch ? "touch" : "send");
    }

    [Theory]
    [InlineData(4)]
    [InlineData(6)]
    [InlineData(8)]
    [InlineData(12)]
    [InlineData(16)]
    [InlineData(24)]
    public void SectorCellsAreExactUnionsOfGridCells(int sectors)
    {
        var expected = Fixture["sectorCells"]![sectors.ToString()]!.AsArray()
            .Select(s => s!.AsArray().Select(v => v!.GetValue<int>()).ToArray()).ToArray();
        Assert.Equal(sectors, expected.Length);

        // Formula of lidar/README.md §6.
        var c = LidarGrid.Cells / sectors;
        Assert.Equal(0, LidarGrid.Cells % sectors);
        Assert.Equal(0, c % 2);
        for (var j = 0; j < sectors; j++)
        {
            var k0 = ((j * c - c / 2) % 96 + 96) % 96;
            Assert.Equal(Enumerable.Range(0, c).Select(x => (k0 + x) % 96).ToArray(), expected[j]);
        }

        // Every sector border [j·W − W/2] falls exactly on a cell border, and
        // the sectors cover each cell exactly once.
        var width = 360.0 / sectors;
        for (var j = 0; j < sectors; j++)
        {
            var border = ((j * width - width / 2) % 360 + 360) % 360;
            Assert.Equal(0, border % LidarGrid.CellDegrees, 9);
            Assert.Equal((int)Math.Round(border / LidarGrid.CellDegrees) % 96, expected[j][0]);
        }
        Assert.Equal(Enumerable.Range(0, 96), expected.SelectMany(s => s).Order());
    }
}
