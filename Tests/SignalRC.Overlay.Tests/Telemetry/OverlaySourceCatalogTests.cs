using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Telemetry;

// D69/D70: the read-only source catalog for viewers.
public sealed class OverlaySourceCatalogTests : IDisposable
{
    private readonly SqliteOverlayTestDb _db = new();

    public void Dispose() => _db.Dispose();

    private int SeedCar()
    {
        using var ctx = _db.Create();
        var car = new Car { Name = "c", CarIdentityKey = Guid.NewGuid().ToString("N"), LastSeen = DateTime.UtcNow };
        ctx.Cars.Add(car);
        ctx.SaveChanges();
        ctx.CarTelemetry.AddRange(
            new CarTelemetry { CarId = car.Id, ChannelName = "speed", DataType = TelemetryDataType.Number, Unit = "km/h", Decimals = 1, ReadIntervalTicks = 1, TelemetryType = "x", PinManager = "x" },
            new CarTelemetry { CarId = car.Id, ChannelName = "grid", DataType = (TelemetryDataType)4, ReadIntervalTicks = 2, TelemetryType = "x", PinManager = "x",
                OptionsJson = """{"zoneLimitsMm":[400,800,1600,3200,6400]}""" });
        ctx.CarChannels.Add(new CarChannel { CarId = car.Id, ChannelName = "steering" });
        ctx.SaveChanges();
        return car.Id;
    }

    [Fact]
    public async Task ViewerGetsChannelsAndOutputsWithoutLoginOrSetup()
    {
        var carId = SeedCar();
        using var ctx = _db.Create();
        var sources = await OverlaySourceCatalog.LoadAsync(ctx, new OverlayAccess(ctx), carId);
        Assert.NotNull(sources);
        var speed = Assert.Single(sources.Telemetry, t => t.ChannelName == "speed");
        Assert.Equal(("number", "km/h", (byte?)1, 1, (int[]?)null), (speed.DataType, speed.Unit, speed.Decimals, speed.ReadIntervalTicks, speed.ZoneLimitsMm));
        var grid = Assert.Single(sources.Telemetry, t => t.ChannelName == "grid");
        Assert.Equal([400, 800, 1600, 3200, 6400], grid.ZoneLimitsMm!);
        Assert.Equal("steering", Assert.Single(sources.Outputs).ChannelName);
        // No personal fields in the viewer catalog.
        Assert.DoesNotContain(typeof(TelemetrySourceInfo).GetProperties(), p => p.Name == "Subscribed");
    }

    [Fact]
    public async Task UnknownVehicleIsNotViewable()
    {
        using var ctx = _db.Create();
        Assert.Null(await OverlaySourceCatalog.LoadAsync(ctx, new OverlayAccess(ctx), 987654));
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("""{"zoneLimitsMm":"500, 1000,2000,3000,5000"}""", new[] { 500, 1000, 2000, 3000, 5000 })]
    [InlineData("""{"zoneLimitsMm":[500,1000]}""", null)]
    [InlineData("""{"zoneLimitsMm":[500,1000,2000,3000,"x"]}""", null)]
    [InlineData("""{"other":1}""", null)]
    [InlineData("not json", null)]
    public void ZoneLimitsFromOptions(string? options, int[]? expected) =>
        Assert.Equal(expected, OverlaySourceCatalog.ZoneLimits(options));
}
