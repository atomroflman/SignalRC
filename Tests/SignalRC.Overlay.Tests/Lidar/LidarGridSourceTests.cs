using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Overlay.Lidar;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Lidar;

public sealed class SqliteLidarGridSourceTests() : LidarGridSourceTests(new SqliteOverlayTestDb());

/// <summary>Runs only with SIGNALRC_TEST_POSTGRES set; see PostgresOverlayTestDb.</summary>
public sealed class PostgresLidarGridSourceTests() : LidarGridSourceTests(PostgresOverlayTestDb.FromEnvironment());

/// <summary>"LiDAR-HUD-Quelle einrichten" (lidar/README.md §7).</summary>
public abstract class LidarGridSourceTests : IDisposable
{
    private readonly IOverlayTestDb? _db;
    private readonly SignalRCContext _ctx = null!;
    private readonly User _driver = null!, _guest = null!, _outsider = null!, _passive = null!;
    private readonly int _carId;

    protected LidarGridSourceTests(IOverlayTestDb? db)
    {
        _db = db;
        if (db == null) return;
        _ctx = db.Create();
        // Unique names so a shared test database never collides with real data.
        var tag = "ap04-" + Guid.NewGuid().ToString("N")[..10];
        long Session() => Random.Shared.NextInt64(1_000_000_000_000, 9_000_000_000_000);
        var car = new Car { Name = $"lidar-test-{tag}", CarIdentityKey = $"lidar-test-{tag}", LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.SaveChanges();
        _carId = car.Id;
        _driver = new User { Name = $"Driver-{tag}", LoginName = $"driver-{tag}", ActiveVehicleId = _carId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _guest = new User { Name = $"Guest-{tag}", ActiveVehicleId = _carId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _outsider = new User { Name = $"Other-{tag}", LoginName = $"other-{tag}", ActiveVehicleId = _carId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _passive = new User { Name = $"Passive-{tag}", LoginName = $"passive-{tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        _ctx.Users.AddRange(_driver, _guest, _outsider, _passive);
        _ctx.SaveChanges();
        _ctx.UserSetups.AddRange(
            new UserCarSetup { UserId = _driver.Id, CarId = _carId },
            new UserCarSetup { UserId = _guest.Id, CarId = _carId },
            new UserCarSetup { UserId = _passive.Id, CarId = _carId });
        _ctx.SaveChanges();
    }

    private void Require() => Skip.If(_db == null, $"{PostgresOverlayTestDb.Variable} ist nicht gesetzt");

    private LidarGridSourceService Service() => new(_ctx, new OverlayAccess(_ctx));

    private CarTelemetry? Channel()
    {
        using var read = _db!.Create();
        return read.CarTelemetry.AsNoTracking().SingleOrDefault(t => t.CarId == _carId && t.ChannelName == "lidarGrid");
    }

    public void Dispose()
    {
        if (_db == null) return;
        _ctx.Dispose();
        using (var cleanup = _db.Create())
        {
            var users = new List<int> { _driver.Id, _guest.Id, _outsider.Id, _passive.Id };
            cleanup.UserSetups.Where(s => s.CarId == _carId).ExecuteDelete();
            cleanup.Users.Where(u => users.Contains(u.Id)).ExecuteDelete();
            cleanup.CarTelemetry.Where(t => t.CarId == _carId).ExecuteDelete();
            cleanup.CarPinManagers.Where(p => p.CarId == _carId).ExecuteDelete();
            cleanup.Cars.Where(c => c.Id == _carId).ExecuteDelete();
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    [SkippableFact]
    public async Task OnlyTheRegularActiveDriverMaySetItUp()
    {
        Require();
        var service = Service();
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.EnsureAsync(_carId, null)).Error?.Code);
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.EnsureAsync(_carId, _guest)).Error?.Code);
        Assert.Equal("OVL_API_NO_CAR_ACCESS", (await service.EnsureAsync(_carId, _outsider)).Error?.Code);
        Assert.Equal("OVL_API_NOT_DRIVER", (await service.EnsureAsync(_carId, _passive)).Error?.Code);
        Assert.Equal(404, (await service.EnsureAsync(int.MaxValue, _driver)).Error?.Status);
        Assert.Null(Channel());
    }

    [SkippableFact]
    public async Task CreatesTheChannelWithTheContractOptions()
    {
        Require();
        var hashBefore = _ctx.Cars.AsNoTracking().Single(c => c.Id == _carId).ChannelMapHash;
        var result = await Service().EnsureAsync(_carId, _driver);
        Assert.Null(result.Error);
        Assert.True(result.Value!.Created);

        var t = Channel()!;
        Assert.Equal("SignalRC.Onboard.Telemetry.LidarGridTelemetryReader", t.TelemetryType);
        Assert.Equal(TelemetryDataType.LidarGrid, t.DataType);
        Assert.Equal(4, (int)t.DataType);
        Assert.Equal(2, t.ReadIntervalTicks);
        Assert.Equal("lidar", t.PinManager);
        var options = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(t.OptionsJson!)!;
        Assert.Equal("lidarGrid", options["groupKey"].GetString());
        Assert.Equal("lidar", options["pinManager"].GetString());
        Assert.Equal(0, options["mountYawDeg"].GetDouble());
        Assert.Equal([500, 1000, 2000, 3000, 5000], options["zoneLimitsMm"].EnumerateArray().Select(v => v.GetInt32()));
        Assert.Equal(50, options["neighborMaxMm"].GetInt32());
        Assert.Equal(3, options["minGroupPoints"].GetInt32());
        // The default direction is not written; it stays the reader's provisional default (D58).
        Assert.False(options.ContainsKey("scannerClockwise"));

        Assert.NotEqual(hashBefore, _ctx.Cars.AsNoTracking().Single(c => c.Id == _carId).ChannelMapHash);
        var item = LidarGridSourceService.ToMapItem(t);
        Assert.Equal(t.Id, item.ServerId);
        Assert.Equal(TelemetryDataType.LidarGrid, item.DataType);
    }

    [SkippableFact]
    public async Task AnExistingChannelIsLeftAlone()
    {
        Require();
        _ctx.CarTelemetry.Add(new CarTelemetry
        {
            CarId = _carId, ChannelName = "lidarGrid", TelemetryType = "custom", PinManager = "x",
            ReadIntervalTicks = 5, OptionsJson = """{"mountYawDeg":90}""",
        });
        await _ctx.SaveChangesAsync();
        var result = await Service().EnsureAsync(_carId, _driver);
        Assert.False(result.Value!.Created);
        var t = Channel()!;
        Assert.Equal(("custom", 5, """{"mountYawDeg":90}"""), (t.TelemetryType, t.ReadIntervalTicks, t.OptionsJson));

        Assert.False((await Service().EnsureAsync(_carId, _driver)).Value!.Created);
    }

    [SkippableFact]
    public async Task UsesTheVehiclesLidarPinManager()
    {
        Require();
        _ctx.CarPinManagers.Add(new CarPinManager { CarId = _carId, Name = "roofLidar", Type = "LidarManager" });
        await _ctx.SaveChangesAsync();
        Assert.True((await Service().EnsureAsync(_carId, _driver)).Value!.Created);
        var t = Channel()!;
        Assert.Equal("roofLidar", t.PinManager);
        Assert.Contains("\"pinManager\":\"roofLidar\"", t.OptionsJson);
    }
}
