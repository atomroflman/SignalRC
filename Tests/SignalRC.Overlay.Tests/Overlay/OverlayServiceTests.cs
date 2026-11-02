using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Overlay.Assets;
using SignalRC.Server.Overlay.Expressions;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Overlay;

public sealed class SqliteOverlayServiceTests() : OverlayServiceTests(new SqliteOverlayTestDb());

/// <summary>Runs only with SIGNALRC_TEST_POSTGRES set; see PostgresOverlayTestDb.</summary>
public sealed class PostgresOverlayServiceTests() : OverlayServiceTests(PostgresOverlayTestDb.FromEnvironment());

public abstract class OverlayServiceTests : IDisposable
{
    private readonly IOverlayTestDb? _db;
    private readonly SignalRCContext _ctx = null!;
    private readonly FakeNotifier _events = new();
    private readonly FakeTime _time = new();
    private readonly FakeSanitizer _sanitizer = new();
    private readonly User _driver = null!, _guest = null!, _outsider = null!, _passive = null!;
    private int CarId { get; }

    protected OverlayServiceTests(IOverlayTestDb? db)
    {
        _db = db;
        if (db == null) return;
        _ctx = db.Create();
        // Unique keys so a shared test database never collides with real data.
        var tag = Guid.NewGuid().ToString("N")[..12];
        long Session() => Random.Shared.NextInt64(1_000_000_000_000, 9_000_000_000_000);
        var car = new Car { Name = $"overlay-test-{tag}", CarIdentityKey = $"overlay-test-{tag}", LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.SaveChanges();
        CarId = car.Id;
        _driver = new User { Name = $"Driver-{tag}", LoginName = $"driver-{tag}", ActiveVehicleId = CarId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _guest = new User { Name = $"User-{tag}", ActiveVehicleId = CarId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _outsider = new User { Name = $"Other-{tag}", LoginName = $"other-{tag}", ActiveVehicleId = CarId, SessionId = Session(), LastSeen = DateTime.UtcNow };
        _passive = new User { Name = $"Passive-{tag}", LoginName = $"passive-{tag}", SessionId = Session(), LastSeen = DateTime.UtcNow };
        _ctx.Users.AddRange(_driver, _guest, _outsider, _passive);
        _ctx.SaveChanges();
        _ctx.UserSetups.AddRange(
            new UserCarSetup { UserId = _driver.Id, CarId = CarId },
            new UserCarSetup { UserId = _guest.Id, CarId = CarId },
            new UserCarSetup { UserId = _passive.Id, CarId = CarId });
        _ctx.CarVideoStreams.AddRange(
            new CarVideoStream { CarId = CarId, StreamId = $"rear-{tag}", Name = "Rear", Type = "camera", Priority = 2, Width = 640, Height = 480, StartTime = DateTime.UtcNow },
            new CarVideoStream { CarId = CarId, StreamId = $"front-{tag}", Name = "Front", Type = "camera", Priority = 1, Width = 1280, Height = 720, StartTime = DateTime.UtcNow });
        _ctx.CarTelemetry.Add(new CarTelemetry { CarId = CarId, ChannelName = "odoSpeed", DataType = TelemetryDataType.Number, TelemetryType = "x", PinManager = "x" });
        _ctx.CarChannels.Add(new CarChannel { CarId = CarId, ChannelName = "steering" });
        _ctx.SaveChanges();
    }

    private void Require() => Skip.If(_db == null, $"{PostgresOverlayTestDb.Variable} ist nicht gesetzt");

    public void Dispose()
    {
        if (_db == null) return;
        _ctx.Dispose();
        using (var cleanup = _db.Create())
        {
            // A List, not an array: array.Contains binds to the span overload EF Core 9 cannot translate.
            var users = new List<int> { _driver.Id, _guest.Id, _outsider.Id, _passive.Id };
            cleanup.UserSetups.Where(s => s.CarId == CarId).ExecuteDelete();
            cleanup.Users.Where(u => users.Contains(u.Id)).ExecuteDelete();
            cleanup.CarTelemetry.Where(t => t.CarId == CarId).ExecuteDelete();
            cleanup.CarChannels.Where(c => c.CarId == CarId).ExecuteDelete();
            cleanup.CarVideoStreams.Where(v => v.CarId == CarId).ExecuteDelete();
            // Overlay rows go with the vehicle (cascade).
            cleanup.Cars.Where(c => c.Id == CarId).ExecuteDelete();
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Without an analyzer the service takes the D66 fallback (formulas unchecked).</summary>
    private OverlayService Service(Server.Overlay.Documents.IExpressionAnalyzer? expressions = null) =>
        new(_ctx, new OverlayAccess(_ctx), _sanitizer, _events, _time, expressions);

    private static byte[] Doc(string elements = "{}", string children = "[]", string extra = "") =>
        Encoding.UTF8.GetBytes($$"""{"schemaVersion":1,"workspace":{"width":1280,"height":720},"elements":{{elements}},"children":{{children}}{{extra}}}""");

    private static readonly string Speed = """{"e_v":{"type":"valueText","props":{"value":{"base":null,"binding":{"expr":"tel(\"odoSpeed\")"}}}}}""";

    private async Task<long> SaveAsync(byte[] doc, long baseRevision = 0)
    {
        var result = await Service().SaveDraftAsync(CarId, _driver, doc, baseRevision);
        Assert.Null(result.Error);
        return result.Value!.Revision;
    }

    // --- Permissions ---

    [SkippableFact]
    public async Task OnlyTheRegularActiveDriverManagesTheOverlay()
    {
        Require();
        var service = Service();
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.GetDraftAsync(CarId, null)).Error?.Code);
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.GetDraftAsync(CarId, _guest)).Error?.Code);
        Assert.Equal("OVL_API_NO_CAR_ACCESS", (await service.GetDraftAsync(CarId, _outsider)).Error?.Code);
        Assert.Equal("OVL_API_NOT_DRIVER", (await service.GetDraftAsync(CarId, _passive)).Error?.Code);
        Assert.Null((await service.GetDraftAsync(CarId, _driver)).Error);
        Assert.Equal(401, (await service.SaveDraftAsync(CarId, _guest, Doc(), 0)).Error?.Status);
        Assert.Equal(403, (await service.PublishAsync(CarId, _passive, 0, null)).Error?.Status);
    }

    [SkippableFact]
    public async Task LosingControlBlocksFurtherWrites()
    {
        Require();
        await SaveAsync(Doc());
        _driver.ActiveVehicleId = null;
        await _ctx.SaveChangesAsync();
        Assert.Equal("OVL_API_NOT_DRIVER", (await Service().SaveDraftAsync(CarId, _driver, Doc(), 1)).Error?.Code);
    }

    [SkippableFact]
    public async Task UnknownVehicleIsNotFound()
    {
        Require();
        Assert.Equal(404, (await Service().GetDraftAsync(int.MaxValue, _driver)).Error?.Status);
        Assert.Equal(404, (await Service().GetPublishedAsync(int.MaxValue)).Error?.Status);
    }

    // --- Draft ---

    [SkippableFact]
    public async Task StartDocumentUsesTheFirstStream()
    {
        Require();
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal(0, draft.Revision);
        Assert.Equal(1280, draft.Document["workspace"]!["width"]!.GetValue<int>());
        Assert.Equal(720, draft.Document["workspace"]!["height"]!.GetValue<int>());
    }

    [SkippableFact]
    public async Task SavingAdvancesTheRevisionAndRejectsStaleWrites()
    {
        Require();
        Assert.Equal(1, await SaveAsync(Doc()));
        Assert.Equal(2, await SaveAsync(Doc(Speed, """["e_v"]"""), 1));
        var stale = await Service().SaveDraftAsync(CarId, _driver, Doc(), 1);
        Assert.Equal("OVL_API_REVISION_CONFLICT", stale.Error?.Code);
        Assert.Equal(2, stale.Error?.CurrentRevision);
        var first = await Service().SaveDraftAsync(CarId, _driver, Doc(), 0);
        Assert.Equal(409, first.Error?.Status);
        Assert.Equal([1L, 2L], _events.DraftChanges.Select(e => e.Revision));
    }

    [SkippableFact]
    public async Task DraftKeepsTheExactDocument()
    {
        Require();
        var doc = Doc(Speed, """["e_v"]""");
        await SaveAsync(doc);
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal(JsonNode.Parse(doc)!.ToJsonString(), draft.Document.ToJsonString());
        Assert.Equal(_driver.LoginName, draft.UpdatedBy);
    }

    [SkippableFact]
    public async Task StructureErrorsBlockSavingButPublishErrorsDoNot()
    {
        Require();
        var broken = await Service().SaveDraftAsync(CarId, _driver, Doc("""{"e_a":{"type":"rect","props":{"fontSize":1}}}""", """["e_a"]"""), 0);
        Assert.Equal("OVL_API_INVALID_DOCUMENT", broken.Error?.Code);
        Assert.Contains(broken.Error!.Diagnostics!, d => d.Code == "OVL_PROP_UNKNOWN");

        var lidar = """{"e_l":{"type":"lidarWidget","source":"nope"}}""";
        Assert.Equal(1, await SaveAsync(Doc(lidar, """["e_l"]""")));
    }

    [SkippableFact]
    public async Task InvalidJsonAndUnsupportedSchemaAreRejected()
    {
        Require();
        Assert.Equal("OVL_API_INVALID_DOCUMENT", (await Service().SaveDraftAsync(CarId, _driver, "{"u8.ToArray(), 0)).Error?.Code);
        var v2 = Encoding.UTF8.GetBytes("""{"schemaVersion":2,"workspace":{"width":1,"height":1},"elements":{},"children":[]}""");
        Assert.Equal("OVL_API_SCHEMA_UNSUPPORTED", (await Service().SaveDraftAsync(CarId, _driver, v2, 0)).Error?.Code);
    }

    [SkippableFact]
    public async Task OversizedDocumentsAreRejected()
    {
        Require();
        var big = new byte[OverlayService.MaxDocumentBytes + 1];
        Assert.Equal(413, (await Service().SaveDraftAsync(CarId, _driver, big, 0)).Error?.Status);
    }

    [SkippableFact]
    public async Task OnlyTheLastFiftyRevisionsAreKept()
    {
        Require();
        long revision = 0;
        for (var i = 0; i < 55; i++) revision = await SaveAsync(Doc(), revision);
        var kept = await _ctx.OverlayDraftRevisions.Where(r => r.CarId == CarId).Select(r => r.Revision).OrderBy(r => r).ToListAsync();
        Assert.Equal(50, kept.Count);
        Assert.Equal(6, kept[0]);
        Assert.Equal(55, kept[^1]);
    }

    // --- Patch ---

    [SkippableFact]
    public async Task PatchAppliesToTheBaseRevision()
    {
        Require();
        await SaveAsync(Doc());
        var patch = Encoding.UTF8.GetBytes("""[{"op":"add","path":"/elements/e_a","value":{"type":"rect"}},{"op":"replace","path":"/children","value":["e_a"]}]""");
        var result = await Service().PatchDraftAsync(CarId, _driver, patch, 1);
        Assert.Equal(2, result.Value?.Revision);
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal("rect", draft.Document["elements"]!["e_a"]!["type"]!.GetValue<string>());
        Assert.Equal(409, (await Service().PatchDraftAsync(CarId, _driver, patch, 1)).Error?.Status);
    }

    [SkippableFact]
    public async Task PatchOnTheStartDocumentCreatesTheDraft()
    {
        Require();
        var patch = Encoding.UTF8.GetBytes("""[{"op":"replace","path":"/workspace/width","value":800}]""");
        Assert.Equal(1, (await Service().PatchDraftAsync(CarId, _driver, patch, 0)).Value?.Revision);
    }

    [SkippableFact]
    public async Task UnusablePatchesFail()
    {
        Require();
        await SaveAsync(Doc());
        foreach (var body in new[] { """{"op":"add"}""", """[{"op":"replace","path":"/missing","value":1}]""", """[{"op":"move","path":"/a","from":"/b"}]""" })
        {
            Assert.Equal("OVL_API_PATCH_FAILED", (await Service().PatchDraftAsync(CarId, _driver, Encoding.UTF8.GetBytes(body), 1)).Error?.Code);
        }
        // A patch producing an invalid document is a document error, not a patch error.
        var invalid = Encoding.UTF8.GetBytes("""[{"op":"remove","path":"/children"}]""");
        Assert.Equal("OVL_API_INVALID_DOCUMENT", (await Service().PatchDraftAsync(CarId, _driver, invalid, 1)).Error?.Code);
    }

    // --- Publishing, history, restore ---

    [SkippableFact]
    public async Task PublishingCreatesNumberedImmutableStates()
    {
        Require();
        await SaveAsync(Doc(Speed, """["e_v"]"""));
        var first = await Service().PublishAsync(CarId, _driver, 1, "erste Version");
        Assert.Equal(1, first.Value?.Number);
        Assert.Contains(first.Value!.Warnings, d => d.Code == "OVL_EXPR_UNCHECKED");

        await SaveAsync(Doc(), 1);
        var published = (await Service().GetPublishedAsync(CarId)).Value!;
        Assert.Equal(1, published.Number);
        Assert.Empty(published.Assets);
        Assert.NotNull(published.Document["elements"]!["e_v"]);

        Assert.Equal(2, (await Service().PublishAsync(CarId, _driver, 2, null)).Value?.Number);
        var history = (await Service().ListPublicationsAsync(CarId, _driver)).Value!;
        Assert.Equal([2, 1], history.Select(h => h.Number));
        Assert.Equal("erste Version", history[1].Note);
        Assert.Equal(_driver.LoginName, history[1].PublishedBy);
        Assert.Equal([1, 2], _events.Publications.Select(p => p.Number));
    }

    [SkippableFact]
    public async Task TheRegisteredAnalyzerChecksFormulaSources()
    {
        Require();
        var service = Service(ExpressionAnalyzer.Instance);
        await SaveAsync(Doc("""{"e_v":{"type":"valueText","props":{"value":{"base":null,"binding":{"expr":"tel(\"nope\")"}}}}}""", """["e_v"]"""));
        var blocked = await service.PublishAsync(CarId, _driver, 1, null);
        Assert.Equal("OVL_API_PUBLISH_BLOCKED", blocked.Error?.Code);
        Assert.Contains(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE" && d.Location.Element == "e_v");

        await SaveAsync(Doc(Speed, """["e_v"]"""), 1);
        var published = await service.PublishAsync(CarId, _driver, 2, null);
        Assert.Equal(1, published.Value?.Number);
        Assert.DoesNotContain(published.Value!.Warnings, d => d.Code == "OVL_EXPR_UNCHECKED");
    }

    [SkippableFact]
    public async Task PublishingRequiresTheCurrentRevision()
    {
        Require();
        Assert.Equal(409, (await Service().PublishAsync(CarId, _driver, 0, null)).Error?.Status);
        await SaveAsync(Doc());
        await SaveAsync(Doc(), 1);
        Assert.Equal("OVL_API_REVISION_CONFLICT", (await Service().PublishAsync(CarId, _driver, 1, null)).Error?.Code);
    }

    [SkippableFact]
    public async Task PublishErrorsBlockPublishing()
    {
        Require();
        await SaveAsync(Doc("""{"e_l":{"type":"lidarWidget","source":"nope"}}""", """["e_l"]"""));
        var result = await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Equal("OVL_API_PUBLISH_BLOCKED", result.Error?.Code);
        Assert.Contains(result.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE");
        Assert.Null((await Service().GetPublishedAsync(CarId)).Value);
    }

    [SkippableFact]
    public async Task DisabledPartsOnlyWarn()
    {
        Require();
        await SaveAsync(Doc("""{"e_l":{"type":"lidarWidget","source":"nope","disabled":true}}""", """["e_l"]"""));
        Assert.Equal(1, (await Service().PublishAsync(CarId, _driver, 1, null)).Value?.Number);
    }

    [SkippableFact]
    public async Task NoteIsLimited()
    {
        Require();
        await SaveAsync(Doc());
        Assert.Equal(400, (await Service().PublishAsync(CarId, _driver, 1, new string('x', 501))).Error?.Status);
    }

    [SkippableFact]
    public async Task RestoreLoadsAPublicationAsDraftWithoutPublishing()
    {
        Require();
        await SaveAsync(Doc(Speed, """["e_v"]"""));
        var publicationId = (await Service().PublishAsync(CarId, _driver, 1, null)).Value!.PublicationId;
        await SaveAsync(Doc(), 1);
        await Service().PublishAsync(CarId, _driver, 2, null);

        var restored = await Service().RestoreAsync(CarId, _driver, publicationId, 2);
        Assert.Equal(3, restored.Value?.Revision);
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.NotNull(draft.Document["elements"]!["e_v"]);
        var live = (await Service().GetPublishedAsync(CarId)).Value!;
        Assert.Equal(2, live.Number);
        Assert.Null(live.Document["elements"]!["e_v"]);
        Assert.Equal(409, (await Service().RestoreAsync(CarId, _driver, publicationId, 2)).Error?.Status);
    }

    // --- Channel dependencies ---

    [SkippableFact]
    public async Task DependenciesListDraftAndPublishedUses()
    {
        Require();
        var elements = """{"e_v":{"type":"valueText","props":{"value":{"base":null,"binding":{"expr":"tel(\"odoSpeed\") * 3.6"}}}},"e_l":{"type":"lidarWidget","source":"odoSpeed","disabled":true},"e_s":{"type":"linearGauge","props":{"value":{"base":0,"binding":{"expr":"out(\"steering\")"}}}}}""";
        await SaveAsync(Doc(elements, """["e_v","e_l","e_s"]"""));
        await Service().PublishAsync(CarId, _driver, 1, null);
        await SaveAsync(Doc(), 1);

        var speed = (await Service().GetDependenciesAsync(CarId, _driver, "odoSpeed")).Value!;
        Assert.Empty(speed.Draft);
        Assert.Equal(["telemetry:e_v:value", "telemetry:e_l:source"], speed.Published.Select(r => $"{r.Kind}:{r.Location.Element}:{r.Location.Property ?? r.Location.Field}"));
        var steering = (await Service().GetDependenciesAsync(CarId, _driver, "steering")).Value!;
        Assert.Equal(["output"], steering.Published.Select(r => r.Kind));
        Assert.Equal(403, (await Service().GetDependenciesAsync(CarId, _passive, "odoSpeed")).Error?.Status);
    }

    // --- Assets ---

    [SkippableFact]
    public async Task UploadsAreRefusedWithoutSanitizer()
    {
        Require();
        _sanitizer.Available = false;
        Assert.Equal("OVL_API_NOT_AVAILABLE", (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Error?.Code);
        Assert.Empty(_ctx.OverlayAssets.Where(a => a.CarId == CarId));
    }

    [SkippableFact]
    public async Task RealSanitizerStoresOnlyTheNormalizedAsset()
    {
        Require();
        var service = new OverlayService(_ctx, new OverlayAccess(_ctx), new SvgAssetSanitizer(), _events, _time);
        var raw = """
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" onload="alert(1)">
              <script>alert(2)</script>
              <g id="needle"><rect width="2" height="10" fill="red"/></g>
            </svg>
            """u8.ToArray();
        var upload = (await service.UploadAssetAsync(CarId, _driver, raw)).Value!;
        Assert.DoesNotContain("script", upload.Svg);
        Assert.Contains(upload.Report, e => e!["code"]!.GetValue<string>() == SvgReportCodes.RemovedElement);
        var stored = _ctx.OverlayAssets.AsNoTracking().Single(a => a.CarId == CarId);
        Assert.Equal(upload.Svg, stored.Svg);
        Assert.Equal(upload.AssetId, stored.AssetId);
        Assert.Equal(upload.Svg, (await service.GetAssetAsync(CarId, upload.AssetId, _driver)).Value);

        // Same file again: same asset, no second row.
        Assert.Equal(upload.AssetId, (await service.UploadAssetAsync(CarId, _driver, raw)).Value!.AssetId);
        Assert.Single(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId));

        // Rejected files leave nothing behind and carry the report.
        var rejected = await service.UploadAssetAsync(CarId, _driver, """<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><svg>&e;</svg>"""u8.ToArray());
        Assert.Equal("OVL_API_ASSET_REJECTED", rejected.Error?.Code);
        Assert.Contains(rejected.Error!.Report!, e => e!["code"]!.GetValue<string>() == SvgReportCodes.RejectedDoctype);
        Assert.Single(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId));

        // Part ids from the metadata are what documents refer to.
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + upload.AssetId + "\",\"parts\":{\"needle\":{\"props\":{\"rotation\":45}}}}}";
        await SaveAsync(Doc(element, """["e_s"]"""));

        // The editor gets the metadata of the draft's assets with GET draft (AP13).
        var draft = (await service.GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal(upload.AssetId, Assert.Single(draft.Assets).Key);
        Assert.Equal(upload.Metadata.ToJsonString(), draft.Assets[upload.AssetId]!.ToJsonString());

        var published = await service.PublishAsync(CarId, _driver, 1, null);
        Assert.True(published.Error == null, string.Join(", ", published.Error?.Diagnostics?.Select(d => d.Code + "@" + d.Location) ?? []));

        // Viewers get the asset metadata of the publication (part bboxes for "center" pivots, AP13).
        var live = (await service.GetPublishedAsync(CarId)).Value!;
        var meta = Assert.IsType<JsonObject>(Assert.Single(live.Assets).Value);
        Assert.Equal(upload.AssetId, live.Assets.Single().Key);
        Assert.Equal(upload.Metadata.ToJsonString(), meta.ToJsonString());
        Assert.Equal(4, meta["parts"]!["needle"]!["bbox"]!.AsArray().Count);
        var byId = (await service.GetPublicationAsync(CarId, live.PublicationId, _driver)).Value!;
        Assert.Equal(meta.ToJsonString(), byId.Assets[upload.AssetId]!.ToJsonString());

        var unknown = element.Replace("needle", "other");
        var refused = await service.SaveDraftAsync(CarId, _driver, Doc(unknown, """["e_s"]"""), 1);
        Assert.Contains(refused.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_PART");
    }

    [SkippableFact]
    public async Task UploadRequiresAdminAndRespectsLimitsAndRejections()
    {
        Require();
        Assert.Equal(401, (await Service().UploadAssetAsync(CarId, _guest, "<svg/>"u8.ToArray())).Error?.Status);
        Assert.Equal(413, (await Service().UploadAssetAsync(CarId, _driver, new byte[OverlayService.MaxAssetBytes + 1])).Error?.Status);
        _sanitizer.Reject = true;
        Assert.Equal("OVL_API_ASSET_REJECTED", (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Error?.Code);
    }

    [SkippableFact]
    public async Task AssetLifecycleFollowsReferences()
    {
        Require();
        var upload = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + upload.AssetId + "\",\"parts\":{\"p_1\":{\"props\":{\"opacity\":0.5}}}}}";
        Assert.Equal(OverlayAssetStatus.Pending, _ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId).Single().Status);

        // Viewers only see published assets; the administrator sees all.
        Assert.Equal(404, (await Service().GetAssetAsync(CarId, upload.AssetId, null)).Error?.Status);
        Assert.Equal("<svg/>", (await Service().GetAssetAsync(CarId, upload.AssetId, _driver)).Value);

        await SaveAsync(Doc(element, """["e_s"]"""));
        Assert.Equal(OverlayAssetStatus.Active, _ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId).Single().Status);
        await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Equal("<svg/>", (await Service().GetAssetAsync(CarId, upload.AssetId, null)).Value);

        // Removed from the draft, the asset stays: a kept revision and the publication still use it.
        long revision = 1;
        for (var i = 0; i < 55; i++) revision = await SaveAsync(Doc(), revision);
        Assert.Single(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId));
    }

    [SkippableFact]
    public async Task DraftCarriesMetadataOfReferencedAssetsOnly()
    {
        Require();
        Assert.Empty((await Service().GetDraftAsync(CarId, _driver)).Value!.Assets);
        var unused = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        _sanitizer.Next = "<svg id='2'/>";
        var used = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        _sanitizer.Next = "<svg id='3'/>";
        var broken = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        var missing = "sha256-" + new string('0', 64);
        var element = $$$"""{"a":{"type":"svgAsset","assetId":"{{{used.AssetId}}}"},"b":{"type":"svgAsset","assetId":"{{{broken.AssetId}}}"},"c":{"type":"svgAsset","assetId":"{{{missing}}}"}}""";
        await SaveAsync(Doc(element, """["a","b","c"]"""));
        var row = _ctx.OverlayAssets.Single(a => a.CarId == CarId && a.AssetId == broken.AssetId);
        row.MetadataJson = "{not json";
        await _ctx.SaveChangesAsync();

        var assets = (await Service().GetDraftAsync(CarId, _driver)).Value!.Assets;
        Assert.Equal([used.AssetId], assets.Select(a => a.Key));
        Assert.Equal(used.Metadata.ToJsonString(), assets[used.AssetId]!.ToJsonString());
        Assert.NotEqual(unused.AssetId, used.AssetId);
    }

    [SkippableFact]
    public async Task UnreferencedAssetsAreCollected()
    {
        Require();
        var pending = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        _sanitizer.Next = "<svg id='2'/>";
        var used = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        var element = $$$"""{"e_s":{"type":"svgAsset","assetId":"{{{used.AssetId}}}"}}""";
        var revision = await SaveAsync(Doc(element, """["e_s"]"""));

        await Service().CollectGarbageAsync(CarId);
        Assert.Equal(2, _ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId).Count());

        _time.Advance(TimeSpan.FromHours(25));
        await Service().CollectGarbageAsync(CarId);
        Assert.Equal([used.AssetId], _ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId).Select(a => a.AssetId));
        Assert.NotEqual(pending.AssetId, used.AssetId);

        // Once no revision refers to it any more, an active asset goes too.
        for (var i = 0; i < 50; i++) revision = await SaveAsync(Doc(), revision);
        Assert.Empty(_ctx.OverlayAssets.AsNoTracking().Where(a => a.CarId == CarId));
    }

    [SkippableFact]
    public async Task UnknownAssetsBlockPublishing()
    {
        Require();
        await SaveAsync(Doc($$$"""{"e_s":{"type":"svgAsset","assetId":"sha256-{{{new string('a', 64)}}}"}}""", """["e_s"]"""));
        var result = await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Contains(result.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_ASSET");
    }

    // --- Concurrency (real database only) ---

    [SkippableFact]
    public async Task ConcurrentSavesFromTheSameRevisionHaveOneWinner()
    {
        Require();
        Skip.IfNot(_db!.SupportsConcurrency, "nur mit echter Datenbank aussagekräftig");
        await SaveAsync(Doc());
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var ctx = _db.Create();
            var service = new OverlayService(ctx, new OverlayAccess(ctx), _sanitizer, _events, _time);
            var user = await ctx.Users.SingleAsync(u => u.Id == _driver.Id);
            return await service.SaveDraftAsync(CarId, user, Doc(), 1);
        }));
        Assert.Single(results, r => r.Error == null);
        Assert.All(results.Where(r => r.Error != null), r => Assert.Equal("OVL_API_REVISION_CONFLICT", r.Error!.Code));
        Assert.Equal(2, (await Service().GetDraftAsync(CarId, _driver)).Value!.Revision);
    }

    [SkippableFact]
    public async Task ConcurrentFirstSavesHaveOneWinner()
    {
        Require();
        Skip.IfNot(_db!.SupportsConcurrency, "nur mit echter Datenbank aussagekräftig");
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(async _ =>
        {
            await using var ctx = _db.Create();
            var service = new OverlayService(ctx, new OverlayAccess(ctx), _sanitizer, _events, _time);
            var user = await ctx.Users.SingleAsync(u => u.Id == _driver.Id);
            return await service.SaveDraftAsync(CarId, user, Doc(), 0);
        }));
        Assert.Single(results, r => r.Error == null);
        Assert.All(results.Where(r => r.Error != null), r => Assert.Equal(409, r.Error!.Status));
    }

    [SkippableFact]
    public async Task ConcurrentPublishesGetDistinctNumbers()
    {
        Require();
        Skip.IfNot(_db!.SupportsConcurrency, "nur mit echter Datenbank aussagekräftig");
        await SaveAsync(Doc());
        var results = await Task.WhenAll(Enumerable.Range(0, 4).Select(async _ =>
        {
            await using var ctx = _db.Create();
            var service = new OverlayService(ctx, new OverlayAccess(ctx), _sanitizer, _events, _time);
            var user = await ctx.Users.SingleAsync(u => u.Id == _driver.Id);
            return await service.PublishAsync(CarId, user, 1, null);
        }));
        var numbers = results.Where(r => r.Error == null).Select(r => r.Value!.Number).OrderBy(n => n).ToList();
        Assert.NotEmpty(numbers);
        Assert.Equal(numbers.Count, numbers.Distinct().Count());
        Assert.All(results.Where(r => r.Error != null), r => Assert.Equal(409, r.Error!.Status));
    }

    // --- Test doubles ---

    private sealed class FakeNotifier : IOverlayNotifier
    {
        public readonly List<(int CarId, long Revision)> DraftChanges = [];
        public readonly List<(int CarId, int PublicationId, int Number)> Publications = [];

        public Task DraftChangedAsync(int carId, long revision)
        {
            DraftChanges.Add((carId, revision));
            return Task.CompletedTask;
        }

        public Task PublishedAsync(int carId, int publicationId, int number)
        {
            Publications.Add((carId, publicationId, number));
            return Task.CompletedTask;
        }
    }

    private sealed class FakeTime : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }

    private sealed class FakeSanitizer : ISvgAssetSanitizer
    {
        public bool Reject;
        public bool Available = true;
        public string Next = "<svg/>";
        public bool IsAvailable => Available;

        public SvgSanitizeResult Sanitize(ReadOnlySpan<byte> raw)
        {
            if (Reject) return new SvgSanitizeResult(false, null, null, null, [new JsonObject { ["code"] = "SVG_REJECTED_PARSE", ["count"] = 1 }]);
            var hash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(Next)));
            var metadata = new JsonObject
            {
                ["width"] = 10, ["height"] = 10,
                ["parts"] = new JsonObject { ["p_1"] = new JsonObject { ["tag"] = "path", ["bbox"] = new JsonArray(0, 0, 10, 10) } },
            };
            return new SvgSanitizeResult(true, $"sha256-{hash}", Next, metadata, []);
        }
    }
}
