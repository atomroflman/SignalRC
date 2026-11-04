using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Telemetry;

public sealed class SqliteTelemetryDebugTests() : TelemetryDebugTests(new SqliteOverlayTestDb());

/// <summary>Runs only with SIGNALRC_TEST_POSTGRES set; see PostgresOverlayTestDb.</summary>
public sealed class PostgresTelemetryDebugTests() : TelemetryDebugTests(PostgresOverlayTestDb.FromEnvironment());

/// <summary>GET telemetry-debug: access after D73 and the relay state it shows.</summary>
public abstract class TelemetryDebugTests : IDisposable
{
    private readonly IOverlayTestDb? _db;
    private readonly SignalRCContext _ctx = null!;
    private readonly User _driver = null!, _guest = null!, _outsider = null!;
    private readonly int _carId, _speedId, _lidarId, _voltId;
    private readonly CarConnectionStore _connections = new();
    private readonly NullTransport _transport = new();
    private readonly TelemetryRelay _relay = null!;

    protected TelemetryDebugTests(IOverlayTestDb? db)
    {
        _db = db;
        if (db == null) return;
        _ctx = db.Create();
        // Unique names so a shared test database never collides with real data.
        var tag = "tlmdiag-" + Guid.NewGuid().ToString("N")[..10];
        long Session() => Random.Shared.NextInt64(1_000_000_000_000, 9_000_000_000_000);
        var car = new Car { Name = $"tlmdiag-test-{tag}", CarIdentityKey = $"tlmdiag-test-{tag}", LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.SaveChanges();
        _carId = car.Id;
        _driver = new User { Name = $"Driver-{tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        _guest = new User { Name = $"Guest-{tag}", ActiveVehicleId = _carId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _outsider = new User { Name = $"Other-{tag}", LoginName = $"other-{tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        _ctx.Users.AddRange(_driver, _guest, _outsider);
        var speed = new CarTelemetry { CarId = _carId, ChannelName = "speed", TelemetryType = "t", DataType = TelemetryDataType.Number };
        var lidar = new CarTelemetry { CarId = _carId, ChannelName = "lidarGrid", TelemetryType = "t", DataType = TelemetryDataType.LidarGrid };
        var volt = new CarTelemetry { CarId = _carId, ChannelName = "volt", TelemetryType = "t", DataType = TelemetryDataType.Number };
        _ctx.CarTelemetry.AddRange(speed, lidar, volt);
        _ctx.SaveChanges();
        (_speedId, _lidarId, _voltId) = (speed.Id, lidar.Id, volt.Id);
        _connections.Connect(_carId);
        _connections.Acquire(_carId, _driver);
        var names = new Dictionary<int, string> { [_speedId] = "speed", [_lidarId] = "lidarGrid", [_voltId] = "volt" };
        _relay = new TelemetryRelay(_transport, new FixedDirectory(names), TimeProvider.System, NullLogger<TelemetryRelay>.Instance);
    }

    private void Require() => Skip.If(_db == null, $"{PostgresOverlayTestDb.Variable} ist nicht gesetzt");

    private TelemetryDebugService Service() => new(_ctx, new OverlayAccess(_ctx, _connections), _relay);

    public void Dispose()
    {
        if (_db == null) return;
        _ctx.Dispose();
        using (var cleanup = _db.Create())
        {
            var users = new List<int> { _driver.Id, _guest.Id, _outsider.Id };
            cleanup.Users.Where(u => users.Contains(u.Id)).ExecuteDelete();
            cleanup.CarTelemetry.Where(t => t.CarId == _carId).ExecuteDelete();
            cleanup.Cars.Where(c => c.Id == _carId).ExecuteDelete();
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>A dense grid with <paramref name="occupied"/> fields set.</summary>
    internal static string DenseGrid(int occupied, bool complete = true)
    {
        var bytes = new byte[96 * 5 * 2];
        for (var i = 0; i < 96 * 5; i++)
        {
            var v = i < occupied ? 120 : 0xFFFF;
            bytes[i * 2] = (byte)(v & 0xFF);
            bytes[i * 2 + 1] = (byte)(v >> 8);
        }
        return $"1{(complete ? 1 : 0)}d:{Convert.ToBase64String(bytes)}";
    }

    [SkippableFact]
    public async Task OnlyTheSessionUserHoldingControlMayReadIt()
    {
        Require();
        var service = Service();
        Assert.Null((await service.GetAsync(_carId, _driver)).Error);
        Assert.Equal(401, (await service.GetAsync(_carId, null)).Error?.Status);
        Assert.Equal(("OVL_API_NOT_DRIVER", 403), ((await service.GetAsync(_carId, _guest)).Error?.Code, (await service.GetAsync(_carId, _guest)).Error?.Status));
        Assert.Equal(403, (await service.GetAsync(_carId, _outsider)).Error?.Status);
        Assert.Equal(404, (await service.GetAsync(int.MaxValue, _driver)).Error?.Status);

        // Without control nobody is administrator, the former driver neither.
        _connections.Release(_carId);
        Assert.Equal(403, (await service.GetAsync(_carId, _driver)).Error?.Status);
    }

    [SkippableFact]
    public async Task ShowsCacheDemandAndInterestWithoutConnectionIds()
    {
        Require();
        await _relay.OnboardConnectedAsync(_carId, "onboard-secret-conn");
        await _relay.SetInterestAsync("viewer-secret-a", _carId, [_lidarId, _speedId]);
        await _relay.SetInterestAsync("viewer-secret-b", _carId, [_lidarId]);
        var grid = DenseGrid(7);
        await _relay.OnDeltaAsync(_carId, new TelemetryDelta
        {
            Epoch = "ep1", Seq = 4, AgeMs = 30,
            Changed = [new() { Id = _speedId, Value = "12.5" }, new() { Id = _lidarId, Value = grid, State = TelemetrySampleState.Unchecked }],
        });
        await _relay.OnDeltaAsync(_carId, new TelemetryDelta { Epoch = "ep1", Seq = 5, AgeMs = 30, Touched = [_speedId] });
        await _relay.OnDeltaAsync(_carId, new TelemetryDelta { Epoch = "ep1", Seq = 3, AgeMs = 30, Touched = [_speedId] });
        await Task.Delay(300);

        var state = (await Service().GetAsync(_carId, _driver)).Value!;
        Assert.True(state.OnboardConnected);
        Assert.Equal(("ep1", 5L), (state.Epoch, state.Seq));
        Assert.Equal((2L, 1L), (state.AcceptedDeltas, state.DroppedOldSeq));
        Assert.InRange(state.LastMessageAgoMs ?? -1, 0, 5000);
        Assert.Equal(2, state.InterestedConnections);
        Assert.Equal(new[] { _speedId, _lidarId }.Order(), state.Demand);

        var speed = state.Channels.Single(c => c.Id == _speedId);
        Assert.Equal(("speed", "Number", "12.5", "Valid", true, 1, 1L, 1L), (speed.Name, speed.DataType, speed.Value, speed.State, speed.InDemand, speed.Interested, speed.Changes, speed.Touches));
        Assert.InRange(speed.AgeMs ?? -1, 30, 5000);
        Assert.Null(speed.Lidar);

        var lidar = state.Channels.Single(c => c.Id == _lidarId);
        Assert.Equal(("LidarGrid", "Unchecked", 2, grid.Length), (lidar.DataType, lidar.State, lidar.Interested, lidar.ValueLength));
        Assert.Equal(TelemetryDebugService.MaxValueChars + 1, lidar.Value!.Length);
        Assert.Equal(new LidarGridSummary(grid.Length, true, "dense", 7, null), lidar.Lidar);

        // A defined channel without samples or interest is listed empty.
        var volt = state.Channels.Single(c => c.Id == _voltId);
        Assert.Equal((null, null, false, 0), (volt.Value, volt.State, volt.InDemand, volt.Interested));

        var json = JsonSerializer.Serialize(state);
        Assert.DoesNotContain("secret", json);
        Assert.DoesNotContain(_driver.Name!, json);
    }

    [SkippableFact]
    public async Task WithoutOnboardTheVehicleIsShownOffline()
    {
        Require();
        var state = (await Service().GetAsync(_carId, _driver)).Value!;
        Assert.False(state.OnboardConnected);
        Assert.Null(state.Seq);
        Assert.Null(state.LastMessageAgoMs);
        Assert.Empty(state.Demand);
        Assert.Equal(3, state.Channels.Count);
    }

    private sealed class FixedDirectory(IReadOnlyDictionary<int, string> names) : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) => Task.FromResult(names);
    }

    private sealed class NullTransport : ITelemetryTransport
    {
        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) => Task.CompletedTask;
        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }
}

public class LidarGridSummaryTests
{
    [Theory]
    [InlineData("garbage", "format")]
    [InlineData("11d:AAA", "base64")]
    [InlineData("11d:AAAA", "length")]
    [InlineData("10s:AQAKAAEACgA=", "index")]
    public void NamesTheBrokenRule(string value, string error) =>
        Assert.Equal(error, TelemetryDebugService.SummarizeLidarGrid(value).Error);

    [Fact]
    public void CountsSparseFields()
    {
        // index 1 → 10 cm, index 5 → 20 cm
        var bytes = new byte[] { 1, 0, 10, 0, 5, 0, 20, 0 };
        var s = TelemetryDebugService.SummarizeLidarGrid("10s:" + Convert.ToBase64String(bytes));
        Assert.Equal((false, "sparse", 2, (string?)null), (s.Complete, s.Encoding, s.Occupied, s.Error));
        Assert.Equal(7, TelemetryDebugService.SummarizeLidarGrid(TelemetryDebugTests.DenseGrid(7, false)).Occupied);
    }
}
