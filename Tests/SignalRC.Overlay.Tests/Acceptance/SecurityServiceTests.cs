using System.Security.Claims;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Overlay.Assets;
using SignalRC.Server.Overlay.Expressions;
using SignalRC.Server.Overlay.Lidar;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Acceptance;

public sealed class SqliteSecurityServiceTests() : SecurityServiceTests(new SqliteOverlayTestDb());

/// <summary>Runs only with SIGNALRC_TEST_POSTGRES set.</summary>
public sealed class PostgresSecurityServiceTests() : SecurityServiceTests(PostgresOverlayTestDb.FromEnvironment());

/// <summary>
/// AP14 security acceptance across the overlay server: permission matrix of all
/// REST operations (service and controller), viewer reads (D69/D70), malicious
/// SVGs through the real sanitizer and upload path, asset response headers,
/// cross-vehicle references and the publish block for abusive formulas.
/// </summary>
public abstract class SecurityServiceTests : IDisposable
{
    private readonly IOverlayTestDb? _db;
    private readonly SignalRCContext _ctx = null!;
    private readonly User _driver = null!, _guest = null!, _outsider = null!, _passive = null!, _otherDriver = null!;
    private readonly int _car, _otherCar;
    /// <summary>D73: _driver holds control of _car, _otherDriver of _otherCar.</summary>
    private readonly CarConnectionStore _connections = new();
    private readonly string _tag = Guid.NewGuid().ToString("N")[..12];
    private static readonly Sqids.SqidsEncoder<long> Sqids = new(new Sqids.SqidsOptions { MinLength = 16 });

    protected SecurityServiceTests(IOverlayTestDb? db)
    {
        _db = db;
        if (db == null) return;
        _ctx = db.Create();
        long Session() => Random.Shared.NextInt64(1_000_000_000_000, 9_000_000_000_000);
        var car = new Car { Name = $"ovl-ap14-{_tag}", CarIdentityKey = $"ovl-ap14-{_tag}", LastSeen = DateTime.UtcNow };
        var other = new Car { Name = $"ovl-ap14b-{_tag}", CarIdentityKey = $"ovl-ap14b-{_tag}", LastSeen = DateTime.UtcNow };
        _ctx.Cars.AddRange(car, other);
        _ctx.SaveChanges();
        _car = car.Id;
        _otherCar = other.Id;
        // The driver is an anonymous session user like every website user (D73).
        _driver = new User { Name = $"D-{_tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        // Stale ActiveVehicleId without control grants nothing.
        _guest = new User { Name = $"G-{_tag}", ActiveVehicleId = _car, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _outsider = new User { Name = $"O-{_tag}", LoginName = $"ap14-out-{_tag}", ActiveVehicleId = _car, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _passive = new User { Name = $"P-{_tag}", LoginName = $"ap14-pas-{_tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        _otherDriver = new User { Name = $"X-{_tag}", LoginName = $"ap14-x-{_tag}", ActiveVehicleId = _otherCar, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _ctx.Users.AddRange(_driver, _guest, _outsider, _passive, _otherDriver);
        _ctx.SaveChanges();
        _connections.Connect(_car);
        _connections.Acquire(_car, _driver);
        _connections.Connect(_otherCar);
        _connections.Acquire(_otherCar, _otherDriver);
        _ctx.UserSetups.AddRange(
            new UserCarSetup { UserId = _driver.Id, CarId = _car },
            new UserCarSetup { UserId = _guest.Id, CarId = _car },
            new UserCarSetup { UserId = _passive.Id, CarId = _car },
            new UserCarSetup { UserId = _otherDriver.Id, CarId = _otherCar });
        _ctx.CarTelemetry.Add(new CarTelemetry { CarId = _car, ChannelName = "speed", DataType = TelemetryDataType.Number, TelemetryType = "x", PinManager = "secret-pin", Unit = "km/h" });
        _ctx.CarChannels.Add(new CarChannel { CarId = _car, ChannelName = "steering" });
        _ctx.CarTelemetry.Add(new CarTelemetry { CarId = _otherCar, ChannelName = "foreign", DataType = TelemetryDataType.Number, TelemetryType = "x", PinManager = "x" });
        _ctx.SaveChanges();
    }

    private void Require() => Skip.If(_db == null, $"{PostgresOverlayTestDb.Variable} ist nicht gesetzt");

    public void Dispose()
    {
        if (_db == null) return;
        _ctx.Dispose();
        using (var cleanup = _db.Create())
        {
            var users = new List<int> { _driver.Id, _guest.Id, _outsider.Id, _passive.Id, _otherDriver.Id };
            var cars = new List<int> { _car, _otherCar };
            cleanup.UserSetups.Where(s => cars.Contains(s.CarId) || users.Contains(s.UserId)).ExecuteDelete();
            cleanup.Users.Where(u => users.Contains(u.Id)).ExecuteDelete();
            cleanup.CarTelemetry.Where(t => cars.Contains(t.CarId)).ExecuteDelete();
            cleanup.CarChannels.Where(c => cars.Contains(c.CarId)).ExecuteDelete();
            cleanup.Cars.Where(c => cars.Contains(c.Id)).ExecuteDelete();
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private OverlayService Service(SignalRCContext? ctx = null)
    {
        ctx ??= _ctx;
        return new OverlayService(ctx, new OverlayAccess(ctx, _connections), new SvgAssetSanitizer(), new NullNotifier(), TimeProvider.System, ExpressionAnalyzer.Instance);
    }

    private static byte[] Doc(string elements = "{}", string children = "[]") =>
        Encoding.UTF8.GetBytes($$"""{"schemaVersion":1,"workspace":{"width":1280,"height":720},"elements":{{elements}},"children":{{children}}}""");

    private static string ValueText(string expr, bool disabled = false) =>
        "{\"e_v\":{\"type\":\"valueText\"" + (disabled ? ",\"disabled\":true" : "") + ",\"props\":{\"value\":{\"base\":null,\"binding\":{\"expr\":" + JsonValue.Create(expr)!.ToJsonString() + "}}}}}";

    private const string Svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="r" width="10" height="10" fill="red"/></svg>""";

    private async Task<long> SaveAsync(byte[] doc, long revision)
    {
        var r = await Service().SaveDraftAsync(_car, _driver, doc, revision);
        Assert.Null(r.Error);
        return r.Value!.Revision;
    }

    // --- 4. Permission matrix ---

    [SkippableFact]
    public async Task EveryManagementOperationRequiresTheSessionUserHoldingControl()
    {
        Require();
        // A publication so publication reads/restore have a real target.
        var revision = await SaveAsync(Doc(), 0);
        var publication = (await Service().PublishAsync(_car, _driver, revision, null)).Value!.PublicationId;
        revision = (await Service().GetDraftAsync(_car, _driver)).Value!.Revision;

        var operations = new Dictionary<string, Func<User?, Task<OverlayError?>>>
        {
            ["GET draft"] = async u => (await Service().GetDraftAsync(_car, u)).Error,
            ["PUT draft"] = async u => (await Service().SaveDraftAsync(_car, u, Doc(), revision)).Error,
            ["PATCH draft"] = async u => (await Service().PatchDraftAsync(_car, u, "[]"u8.ToArray(), revision)).Error,
            ["GET publications"] = async u => (await Service().ListPublicationsAsync(_car, u)).Error,
            ["GET publications/{id}"] = async u => (await Service().GetPublicationAsync(_car, publication, u)).Error,
            ["POST publications"] = async u => (await Service().PublishAsync(_car, u, revision, null)).Error,
            ["POST draft/restore"] = async u => (await Service().RestoreAsync(_car, u, publication, revision)).Error,
            ["POST assets"] = async u => (await Service().UploadAssetAsync(_car, u, Encoding.UTF8.GetBytes(Svg))).Error,
            ["GET dependencies"] = async u => (await Service().GetDependenciesAsync(_car, u, "speed")).Error,
            ["POST lidar-grid-source"] = async u => (await new LidarGridSourceService(_ctx, new OverlayAccess(_ctx, _connections)).EnsureAsync(_car, u)).Error,
        };
        var expected = new (string Who, User? User, string Code)[]
        {
            ("no session", null, "OVL_API_SESSION_REQUIRED"),
            ("session user with stale ActiveVehicleId", _guest, "OVL_API_NOT_DRIVER"),
            ("login without user setup", _outsider, "OVL_API_NOT_DRIVER"),
            ("login with user setup, no control", _passive, "OVL_API_NOT_DRIVER"),
            ("driver of another vehicle", _otherDriver, "OVL_API_NOT_DRIVER"),
        };
        foreach (var (name, op) in operations)
        {
            foreach (var (who, user, code) in expected)
            {
                var error = await op(user);
                Assert.True(error?.Code == code, $"{name} as {who}: expected {code}, got {error?.Code ?? "success"}");
            }
        }
        // The draft is unchanged by all refused writes.
        Assert.Equal(revision, (await Service().GetDraftAsync(_car, _driver)).Value!.Revision);
        Assert.Single(_ctx.OverlayPublications.AsNoTracking().Where(p => p.CarId == _car));
        Assert.Empty(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == _car));
        Assert.Empty(_ctx.CarTelemetry.AsNoTracking().Where(t => t.CarId == _car && t.ChannelName == LidarGridSourceService.ChannelName));

        // The anonymous session user holding control passes every operation.
        foreach (var (name, op) in operations)
        {
            var error = await op(_driver);
            Assert.True(error == null || error.Code is "OVL_API_REVISION_CONFLICT", $"{name} as driver: {error?.Code}");
            revision = (await Service().GetDraftAsync(_car, _driver)).Value!.Revision;
        }
    }

    [SkippableFact]
    public async Task ViewersReadOnlyPublishedStateAssetsAndTheSourceCatalog()
    {
        Require();
        // Unknown vehicle: nothing, also no catalog.
        Assert.Equal(404, (await Service().GetPublishedAsync(int.MaxValue - 7)).Error?.Status);
        Assert.Null(await OverlaySourceCatalog.LoadAsync(_ctx, new OverlayAccess(_ctx, _connections), int.MaxValue - 7));

        // Anonymous viewers get the catalog without personal or wiring fields (D69/D70).
        var sources = await OverlaySourceCatalog.LoadAsync(_ctx, new OverlayAccess(_ctx, _connections), _car);
        var json = Contracts.ToJson(sources)!.ToJsonString();
        Assert.Contains("\"speed\"", json);
        Assert.Contains("\"steering\"", json);
        Assert.DoesNotContain("secret-pin", json);
        Assert.DoesNotContain(_driver.Name!, json);

        var upload = (await Service().UploadAssetAsync(_car, _driver, Encoding.UTF8.GetBytes(Svg))).Value!;
        foreach (var viewer in new[] { null, _guest, _outsider, _passive, _otherDriver })
        {
            Assert.Equal(404, (await Service().GetAssetAsync(_car, upload.AssetId, viewer)).Error?.Status);
        }
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + upload.AssetId + "\"}}";
        var revision = await SaveAsync(Doc(element, "[\"e_s\"]"), 0);
        // Only in the draft: still hidden from viewers.
        Assert.Equal(404, (await Service().GetAssetAsync(_car, upload.AssetId, null)).Error?.Status);
        Assert.Null((await Service().PublishAsync(_car, _driver, revision, null)).Error);
        Assert.Equal(upload.Svg, (await Service().GetAssetAsync(_car, upload.AssetId, null)).Value);
        // The same id under another vehicle stays unreachable.
        Assert.Equal(404, (await Service().GetAssetAsync(_otherCar, upload.AssetId, null)).Error?.Status);
        Assert.Equal(404, (await Service().GetAssetAsync(_otherCar, upload.AssetId, _otherDriver)).Error?.Status);
        // The published document carries no user data.
        var published = (await Service().GetPublishedAsync(_car)).Value!;
        Assert.DoesNotContain(_driver.Name!, published.Document.ToJsonString());
    }

    [SkippableFact]
    public async Task ForeignVehicleReferencesCannotBePublishedOrRestored()
    {
        Require();
        // An asset that exists only at the other vehicle.
        var foreign = (await Service().UploadAssetAsync(_otherCar, _otherDriver, Encoding.UTF8.GetBytes(Svg))).Value!;
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + foreign.AssetId + "\"}}";
        var revision = await SaveAsync(Doc(element, "[\"e_s\"]"), 0);
        var blocked = await Service().PublishAsync(_car, _driver, revision, null);
        Assert.Equal("OVL_API_PUBLISH_BLOCKED", blocked.Error?.Code);
        Assert.Contains(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_ASSET");
        Assert.Empty((await Service().GetDraftAsync(_car, _driver)).Value!.Assets);

        // A channel of the other vehicle is unknown here.
        revision = await SaveAsync(Doc(ValueText("tel(\"foreign\")"), "[\"e_v\"]"), revision);
        blocked = await Service().PublishAsync(_car, _driver, revision, null);
        Assert.Contains(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE");

        // A publication id of the other vehicle cannot be read or restored.
        var otherRevision = (await Service().SaveDraftAsync(_otherCar, _otherDriver, Doc(), 0)).Value!.Revision;
        var otherPublication = (await Service().PublishAsync(_otherCar, _otherDriver, otherRevision, null)).Value!.PublicationId;
        Assert.Equal(404, (await Service().GetPublicationAsync(_car, otherPublication, _driver)).Error?.Status);
        Assert.Equal(404, (await Service().RestoreAsync(_car, _driver, otherPublication, revision)).Error?.Status);
    }

    // --- 1. Formulas at the publish check ---

    [SkippableFact]
    public async Task AbusiveFormulasBlockPublishingOnlyInActiveParts()
    {
        Require();
        long revision = 0;
        foreach (var expr in new[] { "globalThis", "constructor(1)", "tel(\"__proto__\")", "eval(\"1\")", "`x`", "1 // c" })
        {
            revision = await SaveAsync(Doc(ValueText(expr), "[\"e_v\"]"), revision);
            var blocked = await Service().PublishAsync(_car, _driver, revision, null);
            Assert.True(blocked.Error?.Code == "OVL_API_PUBLISH_BLOCKED", expr);

            // Explicitly disabled: publishable with a warning (product rule).
            revision = await SaveAsync(Doc(ValueText(expr, disabled: true), "[\"e_v\"]"), revision);
            var published = await Service().PublishAsync(_car, _driver, revision, null);
            Assert.True(published.Error == null, $"{expr}: {published.Error?.Code}");
            Assert.NotEmpty(published.Value!.Warnings);
            revision = (await Service().GetDraftAsync(_car, _driver)).Value!.Revision;
        }
    }

    [SkippableFact]
    public async Task FormulaLimitsApplyEvenToDisabledPartsAndBlockSaving()
    {
        Require();
        var tooDeep = string.Concat(Enumerable.Repeat("abs(", 32)) + "1" + new string(')', 32);
        var tooLong = "\"" + new string('a', 999) + "\"";
        foreach (var expr in new[] { tooDeep, tooLong })
        {
            var result = await Service().SaveDraftAsync(_car, _driver, Doc(ValueText(expr, disabled: true), "[\"e_v\"]"), 0);
            Assert.Equal("OVL_API_INVALID_DOCUMENT", result.Error?.Code);
            // The length is already a schema rule (maxLength), the depth a limit of the analysis.
            Assert.Contains(result.Error!.Diagnostics!, d => d.Code is "OVL_LIMIT_EXCEEDED" or "OVL_SCHEMA_INVALID");
        }
        // 301 formulas in one document.
        var elements = string.Join(",", Enumerable.Range(0, 301).Select(i =>
            "\"e_" + i + "\":{\"type\":\"valueText\",\"disabled\":true,\"props\":{\"value\":{\"base\":null,\"binding\":{\"expr\":\"1\"}}}}"));
        var children = "[" + string.Join(",", Enumerable.Range(0, 301).Select(i => $"\"e_{i}\"")) + "]";
        var many = await Service().SaveDraftAsync(_car, _driver, Doc("{" + elements + "}", children), 0);
        Assert.Equal("OVL_API_INVALID_DOCUMENT", many.Error?.Code);
        Assert.Contains(many.Error!.Diagnostics!, d => d.Code == "OVL_LIMIT_EXCEEDED");
        Assert.Equal(0, (await Service().GetDraftAsync(_car, _driver)).Value!.Revision);
    }

    // --- 2. Malicious SVGs through the real upload path ---

    private static readonly Regex Dangerous = new(
        @"<script|\son[a-z]+\s*=|foreignObject|javascript:|data:|evil\.example|file:|@import|<animate|<set\b|<!ENTITY|<!DOCTYPE|<\?xml-stylesheet|@keyframes|\burl\(\s*['""]?(?!#)",
        RegexOptions.IgnoreCase);

    public static TheoryData<string> MaliciousSvgs()
    {
        var data = new TheoryData<string>();
        foreach (var name in new[] { "script-events", "foreign-object", "external-refs", "xxe", "billion-laughs", "use-bomb", "use-cycle", "use-self", "animations", "not-svg", "malformed" })
        {
            data.Add("fixture:" + name);
        }
        foreach (var name in Inline.Keys) data.Add(name);
        return data;
    }

    private static readonly Dictionary<string, string> Inline = new()
    {
        ["javascript-href"] = """<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="javascript:alert(1)"><rect width="5" height="5"/></a><a href="javascript:alert(2)"><rect width="5" height="5"/></a></svg>""",
        ["data-href"] = """<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" width="5" height="5"/><rect width="5" height="5"/></svg>""",
        ["external-use"] = """<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/a.svg#x"/><rect width="5" height="5" fill="url(https://evil.example/p.svg#g)"/></svg>""",
        ["css-import-url"] = """<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("https://evil.example/x.css"); rect { fill: url(https://evil.example/p.svg#g); }</style><rect width="5" height="5"/></svg>""",
        ["css-keyframes"] = """<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes spin { to { transform: rotate(360deg) } } rect { animation: spin 1s infinite }</style><rect width="5" height="5"/></svg>""",
        ["style-attr-js"] = """<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5" style="fill:url(javascript:alert(1));behavior:url(evil.htc)"/></svg>""",
        ["smil-set"] = """<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"><set attributeName="fill" to="red" begin="0s"/><animate attributeName="x" from="0" to="9" dur="1s"/></rect></svg>""",
        ["stylesheet-pi"] = """<?xml-stylesheet href="https://evil.example/x.css"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/></svg>""",
        ["html-in-svg"] = """<svg xmlns="http://www.w3.org/2000/svg"><rect width="5" height="5"/><html:iframe xmlns:html="http://www.w3.org/1999/xhtml" src="https://evil.example"/></svg>""",
        ["event-uppercase"] = """<svg xmlns="http://www.w3.org/2000/svg" ONLOAD="alert(1)"><rect width="5" height="5" OnClick="alert(2)"/></svg>""",
        ["too-many-elements"] = "<svg xmlns=\"http://www.w3.org/2000/svg\">" + string.Concat(Enumerable.Repeat("<rect width=\"1\" height=\"1\"/>", 2001)) + "</svg>",
        ["tampered-sanitized-output"] = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-part-root="x"><path data-part="p_1" d="M0 0L10 10"/><script>alert(1)</script></svg>""",
    };

    private static byte[] Payload(string name) => name.StartsWith("fixture:")
        ? File.ReadAllBytes(Path.Combine(Contracts.Root, "fixtures", "svg", "input", name["fixture:".Length..] + ".svg"))
        : Encoding.UTF8.GetBytes(Inline[name]);

    [SkippableTheory]
    [MemberData(nameof(MaliciousSvgs))]
    public async Task MaliciousSvgIsRejectedOrStoredOnlyInSanitizedForm(string name)
    {
        Require();
        var result = await Service().UploadAssetAsync(_car, _driver, Payload(name));
        var stored = _ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == _car).ToList();
        if (result.Error != null)
        {
            Assert.Equal("OVL_API_ASSET_REJECTED", result.Error.Code);
            Assert.Equal(422, result.Error.Status);
            Assert.NotNull(result.Error.Report);
            Assert.Empty(stored);
            return;
        }
        var svg = result.Value!.Svg;
        Assert.DoesNotMatch(Dangerous, svg);
        Assert.Null(SvgSafetyCheck.Verify(svg));
        Assert.Equal(svg, Assert.Single(stored).Svg);
        Assert.Equal(result.Value.AssetId, stored[0].AssetId);
    }

    [SkippableFact]
    public async Task OversizedSvgIsRefusedBeforeSanitizingAndNothingIsStored()
    {
        Require();
        var big = Encoding.UTF8.GetBytes("<svg xmlns=\"http://www.w3.org/2000/svg\"><!--" + new string('x', OverlayService.MaxAssetBytes) + "--></svg>");
        Assert.Equal("OVL_API_TOO_LARGE", (await Service().UploadAssetAsync(_car, _driver, big)).Error?.Code);
        var controller = Controller(_driver);
        var response = await controller.UploadAsset(_car, new FormFile(new MemoryStream(big), 0, big.Length, "file", "big.svg"));
        Assert.Equal(413, Status(response));
        Assert.Equal("OVL_API_TOO_LARGE", Code(response));
        Assert.Empty(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == _car));
    }

    // --- Controller level: user from the auth cookie, problem responses, asset headers ---

    private OverlayController Controller(User? user)
    {
        var services = new ServiceCollection().AddSingleton(Sqids).BuildServiceProvider();
        var identity = user == null ? new ClaimsIdentity()
            : new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Sqids.Encode(user.SessionId))], "cookie");
        var http = new DefaultHttpContext { RequestServices = services, User = new ClaimsPrincipal(identity) };
        return new OverlayController(_ctx, Service()) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private static int? Status(IActionResult r) => r switch
    {
        ObjectResult o => o.StatusCode,
        StatusCodeResult s => s.StatusCode,
        ContentResult c => c.StatusCode ?? 200,
        _ => null,
    };

    private static string? Code(IActionResult r) => ((r as ObjectResult)?.Value as JsonObject)?["code"]?.GetValue<string>();

    [SkippableFact]
    public async Task ControllerAppliesTheMatrixFromTheSessionCookie()
    {
        Require();
        var file = () => new FormFile(new MemoryStream(Encoding.UTF8.GetBytes(Svg)), 0, Svg.Length, "file", "a.svg");
        var cases = new (User? User, int Status, string? Code)[]
        {
            (null, 401, "OVL_API_SESSION_REQUIRED"),
            (_guest, 403, "OVL_API_NOT_DRIVER"),
            (_outsider, 403, "OVL_API_NOT_DRIVER"),
            (_passive, 403, "OVL_API_NOT_DRIVER"),
            (_driver, 200, null),
        };
        foreach (var (user, status, code) in cases)
        {
            var draft = await Controller(user).GetDraft(_car);
            Assert.Equal(status, Status(draft));
            Assert.Equal(code, Code(draft));
            var upload = await Controller(user).UploadAsset(_car, file());
            Assert.Equal(status, Status(upload));
            var list = await Controller(user).ListPublications(_car);
            Assert.Equal(status, Status(list));
        }
        // A forged cookie value maps to no user.
        var forged = Controller(null);
        forged.ControllerContext.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "not-a-sqid")], "cookie"));
        Assert.Equal(401, Status(await forged.GetDraft(_car)));

        // PUT without If-Match is refused before any write.
        var put = Controller(_driver);
        put.ControllerContext.HttpContext.Request.Body = new MemoryStream(Doc());
        Assert.Equal(428, Status(await put.PutDraft(_car)));
    }

    [SkippableFact]
    public async Task AssetResponsesCarryCspNosniffAndImmutableCaching()
    {
        Require();
        var upload = (await Service().UploadAssetAsync(_car, _driver, Encoding.UTF8.GetBytes(Svg))).Value!;
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + upload.AssetId + "\"}}";
        var revision = await SaveAsync(Doc(element, "[\"e_s\"]"), 0);
        Assert.Null((await Service().PublishAsync(_car, _driver, revision, null)).Error);

        var viewer = Controller(null);
        var response = await viewer.GetAsset(_car, upload.AssetId);
        var content = Assert.IsType<ContentResult>(response);
        Assert.Equal("image/svg+xml", content.ContentType);
        var headers = viewer.Response.Headers;
        Assert.Equal("default-src 'none'; style-src 'unsafe-inline'", headers.ContentSecurityPolicy.ToString());
        Assert.Equal("nosniff", headers.XContentTypeOptions.ToString());
        Assert.Equal("public, max-age=31536000, immutable", headers.CacheControl.ToString());

        // Refused reads carry no SVG and no caching header.
        var hidden = Controller(null);
        var missing = await hidden.GetAsset(_car, "sha256-" + new string('0', 64));
        Assert.Equal(404, Status(missing));
        Assert.True(string.IsNullOrEmpty(hidden.Response.Headers.CacheControl.ToString()));
    }

    private sealed class NullNotifier : IOverlayNotifier
    {
        public Task DraftChangedAsync(int carId, long revision) => Task.CompletedTask;
        public Task PublishedAsync(int carId, int publicationId, int number) => Task.CompletedTask;
    }
}
