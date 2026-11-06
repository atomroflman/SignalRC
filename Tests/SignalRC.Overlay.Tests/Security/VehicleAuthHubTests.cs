using System.Security.Cryptography;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Server.Security;
using SignalRC.Server.Services;
using SignalRC.Server.Telemetry;
using SignalRC.Shared;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Logs;
using SignalRC.Shared.Security;
using SignalRC.Shared.Update;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>
/// Docs/VehicleKeyAuth.md, S2/S3: the signed vehicle handshake (TOFU device key, key
/// conflict) and the update mode of onboards without a device key, through the real
/// CarConnectionHub methods.
/// </summary>
public sealed class VehicleAuthHubTests : IDisposable
{
    private readonly SqliteOverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly CarConnectionStore _store = new();
    private readonly RecordingHubClients _clients = new();
    private readonly NonceStore _nonces = new();
    private readonly ConfigSessionStore _sessions = new();
    private readonly AvailableTypesRegistry _types = new();
    private readonly ServiceProvider _services;
    private readonly int _car;
    private const string Identity = "vehicle-under-test";

    public VehicleAuthHubTests()
    {
        _ctx = _db.Create();
        var car = new Car { Name = "v", CarIdentityKey = Identity, LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.SaveChanges();
        _car = car.Id;
        _services = new ServiceCollection()
            .AddSingleton(_ctx)
            .AddSingleton(_nonces)
            .AddSingleton(_sessions)
            .AddSingleton(new TelemetryRelay(new NoTransport(), new NoDirectory(), TimeProvider.System, NullLogger<TelemetryRelay>.Instance))
            .BuildServiceProvider();
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
        return new CarConnectionHub(new FakeConfigurationService(), NullLogger<CarConnectionHub>.Instance, null!, _store, null!, null!, _types, null!, null!)
        {
            Context = new FakeCaller(connectionId, http),
            Clients = _clients,
            Groups = _clients,
        };
    }

    private async Task<CarConfiguration> SignIn(string connectionId, (byte[] Pkcs8, byte[] Spki) key, string identity = Identity)
    {
        var hub = Hub(connectionId);
        var nonce = await hub.GetVehicleNonce();
        return await hub.OpenVehicleConnection(new VehicleHello
        {
            CarIdentityKey = identity,
            ChannelMapHash = "client-hash",
            DevicePublicKey = Convert.ToBase64String(key.Spki),
            Nonce = nonce,
            Signature = VehicleKeys.SignWithDeviceKey(key.Pkcs8, nonce),
        });
    }

    private Car Reload() => _ctx.Cars.AsNoTracking().Single(c => c.Id == _car);

    [Fact]
    public async Task TheFirstSignedHandshakeStoresTheDeviceKey()
    {
        var key = VehicleKeys.CreateDeviceKey();
        var config = await SignIn("onboard", key);

        Assert.Equal(VehicleAuthState.Authenticated, config.AuthState);
        Assert.Equal(_car, config.ServerAssignedCarId);
        Assert.Equal(Convert.ToBase64String(key.Spki), Reload().DevicePublicKey);
        Assert.True(_store.IsVehicleConnection("onboard", _car));

        // The same key signs in again after a reconnect.
        var again = await SignIn("onboard-2", key);
        Assert.Equal(VehicleAuthState.Authenticated, again.AuthState);
        Assert.True(_store.IsVehicleConnection("onboard-2", _car));
    }

    [Fact]
    public async Task AnotherDeviceKeyIsAKeyConflictAndNeverDisplacesTheVehicle()
    {
        await SignIn("onboard", VehicleKeys.CreateDeviceKey());
        var config = await SignIn("impostor", VehicleKeys.CreateDeviceKey());

        Assert.Equal(VehicleAuthState.KeyConflict, config.AuthState);
        Assert.Null(config.ChannelMap);
        Assert.True(_store.IsVehicleConnection("onboard", _car));
        Assert.False(_store.IsVehicleConnection("impostor", _car));
        Assert.True(_store.TryGetUpdateMode("impostor", out var entry));
        Assert.Equal(VehicleAuthState.KeyConflict, entry.State);
    }

    [Fact]
    public async Task AReplayedOrForeignNonceOnlyGivesUpdateMode()
    {
        var key = VehicleKeys.CreateDeviceKey();
        var hub = Hub("onboard");
        var nonce = await hub.GetVehicleNonce();
        VehicleHello Hello(string n) => new()
        {
            CarIdentityKey = Identity, DevicePublicKey = Convert.ToBase64String(key.Spki), Nonce = n,
            Signature = VehicleKeys.SignWithDeviceKey(key.Pkcs8, n),
        };

        // A nonce issued to another connection does not count here.
        Assert.Equal(VehicleAuthState.UpdateOnly, (await Hub("other").OpenVehicleConnection(Hello(nonce))).AuthState);
        // A nonce never issued (self-made) neither.
        Assert.Equal(VehicleAuthState.UpdateOnly, (await hub.OpenVehicleConnection(Hello("made-up"))).AuthState);
        // A valid signature over the wrong data neither.
        var fresh = await hub.GetVehicleNonce();
        var forged = Hello(fresh);
        forged.Signature = VehicleKeys.SignWithDeviceKey(key.Pkcs8, "something else");
        Assert.Equal(VehicleAuthState.UpdateOnly, (await hub.OpenVehicleConnection(forged)).AuthState);

        Assert.Null(Reload().DevicePublicKey);
        Assert.False(_store.ContainsKey(_car.ToString()));
    }

    /// <summary>
    /// The startup sequence of an onboard without a device key must run through without
    /// a single exception, otherwise it never reaches its self-update.
    /// </summary>
    [Fact]
    public async Task AnOldOnboardRunsInUpdateModeWithoutAnyException()
    {
        _ctx.CarChannels.Add(new CarChannel { CarId = _car, ChannelName = "server-secret" });
        _ctx.SaveChanges();
        var old = Hub("old-onboard");

        var config = await old.OpenCarConnection(Identity, "local-hash");
        Assert.Equal(VehicleAuthState.UpdateOnly, config.AuthState);
        Assert.Null(config.ChannelMap);
        Assert.Equal("local-hash", config.ChannelMapHash);
        Assert.Equal(_car, config.ServerAssignedCarId);

        await old.ReportOnboardVersion("master", "abc1234");
        await old.RegisterAvailableChannelTypes(_car, new AvailableChannelTypes());
        await old.ReportChannelHealth(new ChannelHealthReport());
        await old.SendOnboardLogs([new OnboardLogEntry()]);
        var sync = await old.SyncChannelMap(new ChannelMapSyncRequest { CarId = _car, ChannelMap = new ChannelMap() });
        await old.RegisterForControl(_car);
        await old.ConnectCar(Identity);
        await old.RegisterAsOnboard(_car.ToString());
        await old.UpdateTelemetry(_car.ToString(), "speed", "1");
        await old.ReportOnboardUpdateStatus(new OnboardUpdateStatus { State = OnboardUpdateStatus.Downloading, TargetCommit = "def5678" });
        await old.ReportOwnerPublicKey(OwnerKey());

        // Nothing of the server's config left, nothing joined, nothing registered as the vehicle.
        Assert.DoesNotContain("server-secret", sync.ChannelMap.ControlChannels.Keys);
        Assert.DoesNotContain(_clients.GroupAdds, g => g.Connection == "old-onboard");
        Assert.False(_store.ContainsKey(_car.ToString()));
        Assert.Null(_types.Get(_car));
        Assert.Null(Reload().OwnerPublicKey);
        // Version and update progress are kept for the UI.
        var entry = _store.UpdateModeOfCar(_car);
        Assert.NotNull(entry);
        Assert.Equal("abc1234", entry!.OnboardCommit);
        Assert.Equal(OnboardUpdateStatus.Downloading, entry.UpdateStatus?.State);
    }

    [Fact]
    public async Task AnUpdateModeConnectionNeverTakesThePlaceOfTheVehicle()
    {
        await SignIn("onboard", VehicleKeys.CreateDeviceKey());
        await Hub("old-onboard").OpenCarConnection(Identity, "");
        Assert.True(_store.IsVehicleConnection("onboard", _car));
        Assert.Null(_store.UpdateModeOfCar(_car));
    }

    [Fact]
    public async Task ABrowserCannotJoinTheVehicleGroups()
    {
        await SignIn("onboard", VehicleKeys.CreateDeviceKey());
        await Hub("browser").RegisterForControl(_car);
        await Hub("browser").RegisterAsOnboard(_car.ToString());
        await Hub("browser").ConnectCar(Identity);
        Assert.DoesNotContain(_clients.GroupAdds, g => g.Connection == "browser");

        await Hub("onboard").RegisterForControl(_car);
        Assert.Contains(_clients.GroupAdds, g => g.Connection == "onboard" && g.Group == $"Car-{_car}");
    }

    [Fact]
    public async Task TheSignedInVehicleReportsItsOwnerKeyAndAChangeEndsConfigSessions()
    {
        await SignIn("onboard", VehicleKeys.CreateDeviceKey());
        var first = OwnerKey();
        await Hub("onboard").ReportOwnerPublicKey(first);
        Assert.Equal(first, Reload().OwnerPublicKey);
        var token = _sessions.Create(_car, Reload().OwnerKeyFingerprint!);

        // Reporting the same key again changes nothing.
        await Hub("onboard").ReportOwnerPublicKey(first);
        Assert.True(_sessions.IsValid(_car, token, Reload().OwnerKeyFingerprint));

        var second = OwnerKey();
        await Hub("onboard").ReportOwnerPublicKey(second);
        Assert.Equal(second, Reload().OwnerPublicKey);
        Assert.False(_sessions.IsValid(_car, token, Reload().OwnerKeyFingerprint));

        // A browser cannot set it, an invalid key is ignored.
        await Hub("browser").ReportOwnerPublicKey(OwnerKey());
        await Hub("onboard").ReportOwnerPublicKey("not-a-key");
        Assert.Equal(second, Reload().OwnerPublicKey);
    }

    private static string OwnerKey()
    {
        using var rsa = RSA.Create(2048);
        return Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo());
    }

    private sealed class NoTransport : ITelemetryTransport
    {
        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) => Task.CompletedTask;
        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }

    private sealed class NoDirectory : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string>());
    }
}
