using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Overlay.Tests.Relay;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Server.Overlay;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Acceptance;

/// <summary>
/// AP14: origin checks of the hub methods themselves (D56, D57, D70), not only
/// of the relays: the real CarConnectionHub methods with a fake caller context.
/// </summary>
public sealed class SecurityHubOriginTests : IDisposable
{
    private readonly SqliteOverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly CarConnectionStore _store = new();
    private readonly Transport _telemetry = new();
    private readonly ControlDisplayRelayTests.FakeTransport _display = new();
    private readonly TelemetryRelay _relay;
    private readonly ControlDisplayRelay _displayRelay;
    private readonly ServiceProvider _services;
    private readonly int _car, _otherCar;

    public SecurityHubOriginTests()
    {
        _ctx = _db.Create();
        var a = new Car { Name = "a", CarIdentityKey = "ap14-a", LastSeen = DateTime.UtcNow };
        var b = new Car { Name = "b", CarIdentityKey = "ap14-b", LastSeen = DateTime.UtcNow };
        _ctx.Cars.AddRange(a, b);
        _ctx.SaveChanges();
        (_car, _otherCar) = (a.Id, b.Id);
        _relay = new TelemetryRelay(_telemetry, new Directory(), TimeProvider.System, NullLogger<TelemetryRelay>.Instance);
        _displayRelay = new ControlDisplayRelay(_display, TimeProvider.System, NullLogger<ControlDisplayRelay>.Instance);
        _services = new ServiceCollection()
            .AddSingleton(_relay).AddSingleton(_displayRelay)
            .AddSingleton(_ctx).AddSingleton(sp => new OverlayAccess(sp.GetRequiredService<SignalRCContext>(), _store))
            .BuildServiceProvider();
        _store.RegisterConnection(_car.ToString(), "onboard-a");
        _store.RegisterConnection(_otherCar.ToString(), "onboard-b");
    }

    public void Dispose()
    {
        _services.Dispose();
        _ctx.Dispose();
        _db.Dispose();
    }

    private CarConnectionHub Hub(string connectionId)
    {
        var http = new DefaultHttpContext { RequestServices = _services };
        return new CarConnectionHub(null!, NullLogger<CarConnectionHub>.Instance, null!, _store, null!, null!, null!, null!)
        {
            Context = new Caller(connectionId, http),
        };
    }

    private static TelemetryDelta Delta(long seq, string value) => new()
    {
        Epoch = "e", Seq = seq, AgeMs = 0,
        Changed = [new TelemetryChange { Id = 1, Value = value, State = TelemetrySampleState.Valid }],
        Touched = [], TouchedAged = [],
    };

    [Fact]
    public async Task OnlyTheRegisteredOnboardFeedsTelemetryOfItsVehicle()
    {
        await _relay.OnboardConnectedAsync(_car, "onboard-a");
        await Hub("viewer").SetTelemetryInterest(_car, [1]);
        _telemetry.Samples.Clear();

        // A browser and the onboard of another vehicle cannot inject samples (no carId parameter at all).
        await Hub("intruder").UpdateTelemetrySamples(Delta(1, "666"));
        await Hub("onboard-b").UpdateTelemetrySamples(Delta(1, "777"));
        Assert.DoesNotContain(_telemetry.Samples, s => s.Connection == "viewer");

        await Hub("onboard-a").UpdateTelemetrySamples(Delta(2, "12.5"));
        var sample = Assert.Single(_telemetry.Samples, s => s.Connection == "viewer");
        Assert.Equal("[[1,\"12.5\"]]", JsonSerializer.Serialize(sample.Changed));
    }

    [Fact]
    public async Task LegacyUpdateTelemetryChecksTheClaimedVehicle()
    {
        await _relay.OnboardConnectedAsync(_car, "onboard-a");
        await _relay.AddLegacyClientAsync("old-client", _car);
        await Hub("intruder").UpdateTelemetry(_car.ToString(), "speed", "666");
        await Hub("onboard-b").UpdateTelemetry(_car.ToString(), "speed", "777");
        await Hub("onboard-a").UpdateTelemetry(_otherCar.ToString(), "speed", "888");
        Assert.Empty(_telemetry.Legacy);
        await Hub("onboard-a").UpdateTelemetry(_car.ToString(), "speed", "12");
        Assert.Equal([(_car, "speed", "12")], _telemetry.Legacy);
    }

    [Fact]
    public async Task OnlyTheConnectionThatAcquiredControlPublishesControlDisplayValues()
    {
        await _displayRelay.ControlAcquiredAsync(_car, "driver");
        await Hub("viewer").SetControlDisplayInterest(_car, true);
        var signals = JsonDocument.Parse("[[\"horn\",1]]").RootElement;
        await Hub("viewer").Ctl(_car, 1, false, [[11, 0.9]], signals, [], []);
        await Hub("onboard-a").Ctl(_car, 2, false, [[11, 0.9]], signals, [], []);
        await Hub("driver").Ctl(_otherCar, 3, false, [[11, 0.9]], signals, [], []);
        Assert.Empty(_display.Sent);

        // Non-finite and malformed entries from the driver are dropped, not forwarded.
        var mixed = JsonDocument.Parse("[[\"horn\",1],[\"x\"],[1,2],\"y\",[\"z\",\"NaN\"]]").RootElement;
        await Hub("driver").Ctl(_car, 4, false, [[11, 0.5], [12, double.NaN], [13], [14, double.PositiveInfinity]], mixed, [], []);
        var sent = Assert.Single(_display.Sent);
        Assert.Equal("[[11,0.5]]", JsonSerializer.Serialize(sent.Outputs));
        Assert.Equal("[[\"horn\",1]]", JsonSerializer.Serialize(sent.Signals));
    }

    [Fact]
    public async Task InterestsNeedAViewableVehicleButWithdrawingNeverFails()
    {
        await Assert.ThrowsAsync<HubException>(() => Hub("viewer").SetTelemetryInterest(int.MaxValue - 3, [1]));
        await Assert.ThrowsAsync<HubException>(() => Hub("viewer").SetControlDisplayInterest(int.MaxValue - 3, true));
        await Hub("viewer").SetTelemetryInterest(int.MaxValue - 3, []);
        await Hub("viewer").SetControlDisplayInterest(int.MaxValue - 3, false);
        // Anonymous viewers of an existing vehicle may ask for HUD telemetry (D70).
        await Hub("anonymous").SetTelemetryInterest(_car, [1]);
    }

    private sealed class Caller(string connectionId, HttpContext http) : HubCallerContext
    {
        private readonly FeatureCollection _features = new();
        public override string ConnectionId => connectionId;
        public override string? UserIdentifier => null;
        public override ClaimsPrincipal? User => http.User;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override IFeatureCollection Features
        {
            get
            {
                _features.Set<IHttpContextFeature>(new HttpFeature { HttpContext = http });
                return _features;
            }
        }
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() { }
    }

    private sealed class HttpFeature : IHttpContextFeature
    {
        public HttpContext? HttpContext { get; set; }
    }

    private sealed class Directory : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [1] = "speed" });
    }

    private sealed class Transport : ITelemetryTransport
    {
        public readonly List<(string Connection, object[][] Changed)> Samples = [];
        public readonly List<(int Car, string Name, string Value)> Legacy = [];

        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged)
        {
            lock (this) Samples.Add((connectionId, changed));
            return Task.CompletedTask;
        }

        public Task SendLegacyAsync(int carId, string channelName, string value)
        {
            lock (this) Legacy.Add((carId, channelName, value));
            return Task.CompletedTask;
        }

        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }
}
