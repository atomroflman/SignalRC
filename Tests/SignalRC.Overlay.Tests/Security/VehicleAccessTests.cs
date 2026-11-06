using System.Reflection;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Security;
using SignalRC.Shared.Security;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>
/// Docs/VehicleKeyAuth.md, S4–S6: rights (drive, configure), the config session opened
/// with the owner key against the stored owner public key, the endpoint filter, and an
/// inventory of every vehicle endpoint.
/// </summary>
public sealed class VehicleAccessTests : IDisposable
{
    private static readonly Sqids.SqidsEncoder<long> Sqids = new(new Sqids.SqidsOptions { MinLength = 16 });
    private readonly SqliteOverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly CarConnectionStore _connections = new();
    private readonly ConfigSessionStore _sessions = new();
    private readonly NonceStore _nonces = new();
    private readonly ServiceProvider _services;
    private readonly RSA _ownerKey = RSA.Create(2048);
    private readonly User _owner, _driver, _stranger;
    private readonly int _car, _otherCar;

    public VehicleAccessTests()
    {
        _ctx = _db.Create();
        var ownerPublic = Convert.ToBase64String(_ownerKey.ExportSubjectPublicKeyInfo());
        var car = new Car { Name = "c", CarIdentityKey = "c", LastSeen = DateTime.UtcNow, OwnerPublicKey = ownerPublic, OwnerKeyFingerprint = VehicleKeys.Fingerprint(ownerPublic) };
        var other = new Car { Name = "o", CarIdentityKey = "o", LastSeen = DateTime.UtcNow };
        _ctx.Cars.AddRange(car, other);
        long n = 4_000_000_000_000;
        _owner = new User { Name = "owner", SessionId = n++, LastSeen = DateTime.UtcNow };
        _driver = new User { Name = "driver", SessionId = n++, LastSeen = DateTime.UtcNow };
        _stranger = new User { Name = "stranger", SessionId = n, LastSeen = DateTime.UtcNow };
        _ctx.Users.AddRange(_owner, _driver, _stranger);
        _ctx.SaveChanges();
        (_car, _otherCar) = (car.Id, other.Id);
        // Even an old user setup grants nothing any more.
        _ctx.UserSetups.Add(new UserCarSetup { UserId = _stranger.Id, CarId = _car });
        _ctx.SaveChanges();

        _services = new ServiceCollection()
            .AddSingleton(Sqids).AddSingleton(_ctx).AddSingleton(_connections).AddSingleton(_sessions).AddSingleton(_nonces)
            .AddScoped<VehicleAccess>()
            .BuildServiceProvider();
    }

    public void Dispose()
    {
        _services.Dispose();
        _ownerKey.Dispose();
        _ctx.Dispose();
        _db.Dispose();
    }

    private DefaultHttpContext Http(User? user, string? cookie = null, int? cookieCar = null)
    {
        var identity = user == null ? new ClaimsIdentity()
            : new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Sqids.Encode(user.SessionId))], "cookie");
        var http = new DefaultHttpContext { RequestServices = _services.CreateScope().ServiceProvider, User = new ClaimsPrincipal(identity) };
        if (cookie != null) http.Request.Headers.Cookie = $"{ConfigSessionStore.CookieName(cookieCar ?? _car)}={cookie}";
        return http;
    }

    private VehicleAccessController Controller(DefaultHttpContext http) =>
        new(_ctx, http.RequestServices.GetRequiredService<VehicleAccess>(), _sessions, _nonces, _connections, NullLogger<VehicleAccessController>.Instance)
        { ControllerContext = new ControllerContext { HttpContext = http } };

    private void MakeDriver(User user)
    {
        _connections.RegisterConnection(_car.ToString(), "onboard");
        _connections.RememberControlSession(_car.ToString(), "session");
        _connections[_car.ToString()].DriverId = user.Id.ToString();
    }

    private string Sign(string data) =>
        Convert.ToBase64String(_ownerKey.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));

    /// <summary>Opens a config session like the browser does; returns the cookie value.</summary>
    private async Task<string?> OpenSession(User user, Func<string, string>? sign = null)
    {
        var nonceResult = await Controller(Http(user)).IssueNonce(_car);
        var nonce = (string)((dynamic)((OkObjectResult)nonceResult).Value!).GetType().GetProperty("nonce")!.GetValue(((OkObjectResult)nonceResult).Value)!;
        var http = Http(user);
        var result = await Controller(http).Open(_car, new VehicleAccessController.ConfigSessionRequest { Nonce = nonce, Signature = (sign ?? Sign)(nonce) });
        if (result is not OkObjectResult) return null;
        var setCookie = http.Response.Headers.SetCookie.ToString();
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
        return setCookie.Split(';')[0].Split('=', 2)[1];
    }

    private async Task<bool> CanConfigure(User? user, string? cookie = null, int? car = null)
    {
        var http = Http(user, cookie, car);
        return await http.RequestServices.GetRequiredService<VehicleAccess>().CanConfigureAsync(http, car ?? _car);
    }

    [Fact]
    public async Task OnlyTheDriverDrivesAndAUserSetupGrantsNothing()
    {
        MakeDriver(_driver);
        var access = _services.CreateScope().ServiceProvider.GetRequiredService<VehicleAccess>();
        Assert.True(access.IsDriver(_driver, _car));
        Assert.False(access.IsDriver(_stranger, _car));
        Assert.False(access.IsDriver(_driver, _otherCar));
        Assert.True(await CanConfigure(_driver));
        Assert.False(await CanConfigure(_stranger));
        Assert.False(await CanConfigure(null));
    }

    [Fact]
    public async Task AnOwnerKeySignatureOpensAConfigSessionWhileTheVehicleIsOffline()
    {
        Assert.False(_connections.ContainsKey(_car.ToString()));
        var cookie = await OpenSession(_owner);
        Assert.NotNull(cookie);
        Assert.True(await CanConfigure(_owner, cookie));
        // The cookie is the session, not the user; it counts for this vehicle only.
        Assert.False(await CanConfigure(_owner, cookie, _otherCar));
        // Configuring never means driving.
        var http = Http(_owner, cookie);
        Assert.False(await http.RequestServices.GetRequiredService<VehicleAccess>().CanDriveAsync(http, _car));
    }

    [Fact]
    public async Task AWrongSignatureAReusedOrForeignNonceOpenNothing()
    {
        using var otherKey = RSA.Create(2048);
        string Foreign(string data) => Convert.ToBase64String(otherKey.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        Assert.Null(await OpenSession(_stranger, Foreign));
        Assert.Null(await OpenSession(_stranger, _ => "garbage"));

        // A nonce counts once, and only for the user it was issued to.
        var issued = (OkObjectResult)await Controller(Http(_owner)).IssueNonce(_car);
        var nonce = (string)issued.Value!.GetType().GetProperty("nonce")!.GetValue(issued.Value)!;
        var stolen = await Controller(Http(_stranger)).Open(_car, new() { Nonce = nonce, Signature = Sign(nonce) });
        Assert.Equal(403, Assert.IsType<ObjectResult>(stolen).StatusCode);
        var replay = await Controller(Http(_owner)).Open(_car, new() { Nonce = nonce, Signature = Sign(nonce) });
        Assert.Equal(403, Assert.IsType<ObjectResult>(replay).StatusCode);
    }

    [Fact]
    public async Task WithoutAReportedOwnerKeyThereIsNoConfigSession()
    {
        var issued = (OkObjectResult)await Controller(Http(_owner)).IssueNonce(_otherCar);
        var nonce = (string)issued.Value!.GetType().GetProperty("nonce")!.GetValue(issued.Value)!;
        Assert.IsType<ConflictObjectResult>(await Controller(Http(_owner)).Open(_otherCar, new() { Nonce = nonce, Signature = Sign(nonce) }));
    }

    [Fact]
    public async Task ANewOwnerKeyOrClosingEndsTheSession()
    {
        var cookie = await OpenSession(_owner);
        Assert.True(await CanConfigure(_owner, cookie));
        // Closing removes it on the server, not only the cookie.
        var http = Http(_owner, cookie);
        Assert.IsType<NoContentResult>(Controller(http).Close(_car));
        Assert.False(await CanConfigure(_owner, cookie));

        cookie = await OpenSession(_owner);
        using var newKey = RSA.Create(2048);
        var car = _ctx.Cars.Single(c => c.Id == _car);
        car.OwnerPublicKey = Convert.ToBase64String(newKey.ExportSubjectPublicKeyInfo());
        car.OwnerKeyFingerprint = VehicleKeys.Fingerprint(car.OwnerPublicKey);
        _ctx.SaveChanges();
        Assert.False(await CanConfigure(_owner, cookie));
    }

    [Fact]
    public void TheIdleTimeoutEndsASession()
    {
        var time = new FakeTime();
        var sessions = new ConfigSessionStore(time);
        var token = sessions.Create(1, "fp");
        time.Advance(TimeSpan.FromMinutes(119));
        Assert.True(sessions.IsValid(1, token, "fp"));
        // Each use moves the timeout.
        time.Advance(TimeSpan.FromMinutes(119));
        Assert.True(sessions.IsValid(1, token, "fp"));
        time.Advance(TimeSpan.FromHours(2) + TimeSpan.FromSeconds(1));
        Assert.False(sessions.IsValid(1, token, "fp"));
    }

    [Fact]
    public async Task OverlayManagementAcceptsAConfigSessionDrivingFunctionsDoNot()
    {
        var cookie = await OpenSession(_owner);
        var accessor = new HttpContextAccessor { HttpContext = Http(_owner, cookie) };
        var overlay = new OverlayAccess(_ctx, _connections, new RequestConfigSessionGrant(accessor, _ctx, _sessions));
        Assert.Equal(OverlayAccessError.None, overlay.CheckAdmin(_owner, _car));
        Assert.Equal(OverlayAccessError.NotDriver, overlay.CheckDriver(_owner, _car));
        Assert.Equal(OverlayAccessError.NotDriver, overlay.CheckAdmin(_stranger, _otherCar));
    }

    [Fact]
    public async Task TheFilterStopsRequestsWithoutSessionAndLetsSessionsThrough()
    {
        async Task<int?> Run(RequireVehicleAttribute filter, DefaultHttpContext http, int car, bool allowed = false)
        {
            var descriptor = new ActionDescriptor
            {
                FilterDescriptors = [new FilterDescriptor(filter, FilterScope.Action)],
                EndpointMetadata = allowed ? [new AllowWithoutVehicleSessionAttribute()] : [],
            };
            var route = new RouteData(new RouteValueDictionary { ["carId"] = car.ToString() });
            var context = new ActionExecutingContext(new ActionContext(http, route, descriptor), [], new Dictionary<string, object?>(), new object());
            var ran = false;
            await filter.OnActionExecutionAsync(context, () =>
            {
                ran = true;
                return Task.FromResult(new ActionExecutedContext(context, [], new object()));
            });
            return ran ? null : (context.Result as ObjectResult)?.StatusCode;
        }

        var configure = new RequireVehicleAttribute();
        Assert.Equal(403, await Run(configure, Http(_stranger), _car));
        Assert.Equal(403, await Run(configure, Http(null), _car));
        Assert.Null(await Run(configure, Http(_stranger), _car, allowed: true));
        var cookie = await OpenSession(_owner);
        Assert.Null(await Run(configure, Http(_owner, cookie), _car));
        // A config session is no driver.
        Assert.Equal(403, await Run(new RequireVehicleAttribute(VehicleRight.Drive), Http(_owner, cookie), _car));
        MakeDriver(_driver);
        Assert.Null(await Run(new RequireVehicleAttribute(VehicleRight.Drive), Http(_driver), _car));
    }

    /// <summary>
    /// Every endpoint with a vehicle in its route either needs a session (attribute) or
    /// is listed here with the reason it may do without (driving view, own check).
    /// A new endpoint fails this test until it is decided.
    /// </summary>
    [Fact]
    public void EveryVehicleEndpointIsProtectedOrDeliberatelyOpen()
    {
        var checkedElsewhere = new Dictionary<string, string>
        {
            ["VehicleAccessController"] = "opens and reports the sessions itself",
            ["VersionController"] = "driving view: version banner",
            ["CarController"] = "driving view: vehicle list, functions, telemetry selection, identity hash for the key download",
            ["OverlayController"] = "OverlayService checks management (driver or config session) and viewer reads itself",
            ["LidarGridSourceController"] = "LidarGridSourceService checks OverlayAccess.CheckAdmin",
            ["TelemetryDebugController"] = "TelemetryDebugService checks OverlayAccess.CheckAdmin",
            ["UserConfigController"] = "own user data; has-config-access asks VehicleAccess",
            ["WebRtcController"] = "driving view: ICE servers",
            ["OverlaySourcesController"] = "driving view: channel metadata the published HUD renders with (D70)",
        };

        var unprotected = new List<string>();
        foreach (var type in typeof(VehicleAccess).Assembly.GetTypes().Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract))
        {
            if (checkedElsewhere.ContainsKey(type.Name)) continue;
            var classRoute = type.GetCustomAttribute<RouteAttribute>()?.Template ?? "";
            var classRule = type.GetCustomAttribute<RequireVehicleAttribute>();
            foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                var http = method.GetCustomAttributes<HttpMethodAttribute>().FirstOrDefault();
                if (http == null) continue;
                var template = $"{classRoute}/{http.Template}";
                if (!template.Contains("{carId", StringComparison.OrdinalIgnoreCase)) continue;
                var protectedHere = (method.GetCustomAttribute<RequireVehicleAttribute>() ?? classRule) != null
                    && method.GetCustomAttribute<AllowWithoutVehicleSessionAttribute>() == null;
                var openOnPurpose = method.GetCustomAttribute<AllowWithoutVehicleSessionAttribute>() != null;
                if (!protectedHere && !openOnPurpose)
                    unprotected.Add($"{type.Name}.{method.Name} ({string.Join(",", http.HttpMethods)} {template})");
            }
        }
        Assert.Empty(unprotected);
    }

    private sealed class FakeTime : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 6, 12, 0, 0, TimeSpan.Zero);
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }
}
