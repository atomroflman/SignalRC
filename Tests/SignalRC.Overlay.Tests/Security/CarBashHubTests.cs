using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Server.Security;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Security;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>Docs/VehicleKeyAuth.md, S9: the remote shell hub.</summary>
public sealed class CarBashHubTests : IDisposable
{
    private static readonly Sqids.SqidsEncoder<long> Sqids = new(new Sqids.SqidsOptions { MinLength = 16 });
    private readonly SqliteOverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly CarConnectionStore _connections = new();
    private readonly RecordingHubClients<ICarBashClient> _clients = new();
    private readonly ServiceProvider _services;
    private readonly (byte[] Pkcs8, byte[] Spki) _deviceKey = VehicleKeys.CreateDeviceKey();
    private readonly string _identity = "bash-" + Guid.NewGuid().ToString("N");
    private readonly User _driver, _stranger;
    private readonly int _car;

    public CarBashHubTests()
    {
        _ctx = _db.Create();
        var car = new Car { Name = "b", CarIdentityKey = _identity, LastSeen = DateTime.UtcNow, DevicePublicKey = Convert.ToBase64String(_deviceKey.Spki) };
        _driver = new User { Name = "d", SessionId = 5_000_000_000_001, LastSeen = DateTime.UtcNow };
        _stranger = new User { Name = "s", SessionId = 5_000_000_000_002, LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.Users.AddRange(_driver, _stranger);
        _ctx.SaveChanges();
        _car = car.Id;
        _connections.RegisterConnection(_car.ToString(), "onboard");
        _connections.RememberControlSession(_car.ToString(), "session");
        _connections[_car.ToString()].DriverId = _driver.Id.ToString();
        _services = new ServiceCollection()
            .AddSingleton(Sqids).AddSingleton(_ctx).AddSingleton(_connections)
            .AddSingleton(new ConfigSessionStore()).AddSingleton(new NonceStore())
            .AddScoped<VehicleAccess>()
            .BuildServiceProvider();
    }

    public void Dispose()
    {
        _services.Dispose();
        _ctx.Dispose();
        _db.Dispose();
    }

    private CarBashHub Hub(string connectionId, User? user = null)
    {
        var identity = user == null ? new ClaimsIdentity()
            : new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Sqids.Encode(user.SessionId))], "cookie");
        var http = new DefaultHttpContext { RequestServices = _services.CreateScope().ServiceProvider, User = new ClaimsPrincipal(identity) };
        return new CarBashHub(null!, NullLogger<CarBashHub>.Instance)
        {
            Context = new FakeCaller(connectionId, http),
            Clients = _clients,
            Groups = _clients,
        };
    }

    private async Task<bool> RegisterVehicle(string connectionId, byte[] pkcs8)
    {
        var hub = Hub(connectionId);
        var nonce = await hub.GetNonce();
        return await hub.RegisterCarSigned(_identity, nonce, VehicleKeys.SignWithDeviceKey(pkcs8, nonce));
    }

    [Fact]
    public async Task OnlyTheVehicleWithItsDeviceKeyRegisters()
    {
        await Hub("fake-car").RegisterCar(_identity);
        Assert.False(await RegisterVehicle("fake-car", VehicleKeys.CreateDeviceKey().Pkcs8));
        Assert.DoesNotContain(_clients.GroupAdds, g => g.Connection == "fake-car");
        Assert.True(await RegisterVehicle("bash-car", _deviceKey.Pkcs8));
    }

    [Fact]
    public async Task OnlyTheDriversTerminalSendsCommands()
    {
        await RegisterVehicle("bash-car", _deviceKey.Pkcs8);
        await Assert.ThrowsAsync<HubException>(() => Hub("stranger", _stranger).RegisterWebClient(_identity));
        await Assert.ThrowsAsync<HubException>(() => Hub("anonymous").RegisterWebClient(_identity));

        await Hub("stranger", _stranger).ExecuteCommand(_identity, "rm -rf /");
        Assert.DoesNotContain("client:bash-car:OnExecuteCommand", _clients.Calls);

        await Hub("terminal", _driver).RegisterWebClient(_identity);
        // The driver's user on another connection is not the terminal.
        await Hub("other-tab", _driver).ExecuteCommand(_identity, "ls");
        Assert.DoesNotContain("client:bash-car:OnExecuteCommand", _clients.Calls);
        await Hub("terminal", _driver).ExecuteCommand(_identity, "ls");
        Assert.Contains("client:bash-car:OnExecuteCommand", _clients.Calls);
    }

    [Fact]
    public async Task OnlyTheRegisteredVehicleAnswersTheTerminal()
    {
        await RegisterVehicle("bash-car", _deviceKey.Pkcs8);
        await Hub("terminal", _driver).RegisterWebClient(_identity);
        await Hub("intruder").SendToClient(_identity, "OnOutput", "fake");
        Assert.DoesNotContain("client:terminal:OnOutput", _clients.Calls);
        await Hub("bash-car").SendToClient(_identity, "OnOutput", "real");
        Assert.Contains("client:terminal:OnOutput", _clients.Calls);
    }
}
