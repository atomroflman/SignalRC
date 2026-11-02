using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Overlay;

public sealed class OverlayServiceTests : IDisposable
{
    private const int CarId = 1;
    private readonly OverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly FakeNotifier _events = new();
    private readonly FakeTime _time = new();
    private readonly FakeSanitizer _sanitizer = new();
    private readonly User _driver, _guest, _outsider, _passive;

    public OverlayServiceTests()
    {
        _ctx = _db.Create();
        _ctx.Cars.Add(new Car { Id = CarId, Name = "Truck" });
        _driver = new User { Name = "Driver", LoginName = "driver", ActiveVehicleId = CarId, SessionId = 1 };
        _guest = new User { Name = "User_2", ActiveVehicleId = CarId, SessionId = 2 };
        _outsider = new User { Name = "Other", LoginName = "other", ActiveVehicleId = CarId, SessionId = 3 };
        _passive = new User { Name = "Passive", LoginName = "passive", SessionId = 4 };
        _ctx.Users.AddRange(_driver, _guest, _outsider, _passive);
        _ctx.SaveChanges();
        _ctx.UserSetups.AddRange(
            new UserCarSetup { UserId = _driver.Id, CarId = CarId },
            new UserCarSetup { UserId = _guest.Id, CarId = CarId },
            new UserCarSetup { UserId = _passive.Id, CarId = CarId });
        _ctx.CarVideoStreams.AddRange(
            new CarVideoStream { CarId = CarId, StreamId = "rear", Name = "Rear", Type = "camera", Priority = 2, Width = 640, Height = 480, StartTime = DateTime.UtcNow },
            new CarVideoStream { CarId = CarId, StreamId = "front", Name = "Front", Type = "camera", Priority = 1, Width = 1280, Height = 720, StartTime = DateTime.UtcNow });
        _ctx.CarTelemetry.Add(new CarTelemetry { CarId = CarId, ChannelName = "odoSpeed", DataType = TelemetryDataType.Number, TelemetryType = "x", PinManager = "x" });
        _ctx.CarChannels.Add(new CarChannel { CarId = CarId, ChannelName = "steering" });
        _ctx.SaveChanges();
    }

    public void Dispose()
    {
        _ctx.Dispose();
        _db.Dispose();
    }

    private OverlayService Service() =>
        new(_ctx, new OverlayAccess(_ctx), _sanitizer, _events, _time);

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

    [Fact]
    public async Task OnlyTheRegularActiveDriverManagesTheOverlay()
    {
        var service = Service();
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.GetDraftAsync(CarId, null)).Error?.Code);
        Assert.Equal("OVL_API_LOGIN_REQUIRED", (await service.GetDraftAsync(CarId, _guest)).Error?.Code);
        Assert.Equal("OVL_API_NO_CAR_ACCESS", (await service.GetDraftAsync(CarId, _outsider)).Error?.Code);
        Assert.Equal("OVL_API_NOT_DRIVER", (await service.GetDraftAsync(CarId, _passive)).Error?.Code);
        Assert.Null((await service.GetDraftAsync(CarId, _driver)).Error);
        Assert.Equal(401, (await service.SaveDraftAsync(CarId, _guest, Doc(), 0)).Error?.Status);
        Assert.Equal(403, (await service.PublishAsync(CarId, _passive, 0, null)).Error?.Status);
    }

    [Fact]
    public async Task LosingControlBlocksFurtherWrites()
    {
        await SaveAsync(Doc());
        _driver.ActiveVehicleId = null;
        await _ctx.SaveChangesAsync();
        Assert.Equal("OVL_API_NOT_DRIVER", (await Service().SaveDraftAsync(CarId, _driver, Doc(), 1)).Error?.Code);
    }

    [Fact]
    public async Task UnknownVehicleIsNotFound()
    {
        Assert.Equal(404, (await Service().GetDraftAsync(99, _driver)).Error?.Status);
        Assert.Equal(404, (await Service().GetPublishedAsync(99)).Error?.Status);
    }

    // --- Draft ---

    [Fact]
    public async Task StartDocumentUsesTheFirstStream()
    {
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal(0, draft.Revision);
        Assert.Equal(1280, draft.Document["workspace"]!["width"]!.GetValue<int>());
        Assert.Equal(720, draft.Document["workspace"]!["height"]!.GetValue<int>());
    }

    [Fact]
    public async Task SavingAdvancesTheRevisionAndRejectsStaleWrites()
    {
        Assert.Equal(1, await SaveAsync(Doc()));
        Assert.Equal(2, await SaveAsync(Doc(Speed, """["e_v"]"""), 1));
        var stale = await Service().SaveDraftAsync(CarId, _driver, Doc(), 1);
        Assert.Equal("OVL_API_REVISION_CONFLICT", stale.Error?.Code);
        Assert.Equal(2, stale.Error?.CurrentRevision);
        var first = await Service().SaveDraftAsync(CarId, _driver, Doc(), 0);
        Assert.Equal(409, first.Error?.Status);
        Assert.Equal([1L, 2L], _events.DraftChanges.Select(e => e.Revision));
    }

    [Fact]
    public async Task DraftKeepsTheExactDocument()
    {
        var doc = Doc(Speed, """["e_v"]""");
        await SaveAsync(doc);
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal(JsonNode.Parse(doc)!.ToJsonString(), draft.Document.ToJsonString());
        Assert.Equal("driver", draft.UpdatedBy);
    }

    [Fact]
    public async Task StructureErrorsBlockSavingButPublishErrorsDoNot()
    {
        var broken = await Service().SaveDraftAsync(CarId, _driver, Doc("""{"e_a":{"type":"rect","props":{"fontSize":1}}}""", """["e_a"]"""), 0);
        Assert.Equal("OVL_API_INVALID_DOCUMENT", broken.Error?.Code);
        Assert.Contains(broken.Error!.Diagnostics!, d => d.Code == "OVL_PROP_UNKNOWN");

        var lidar = """{"e_l":{"type":"lidarWidget","source":"nope"}}""";
        Assert.Equal(1, await SaveAsync(Doc(lidar, """["e_l"]""")));
    }

    [Fact]
    public async Task InvalidJsonAndUnsupportedSchemaAreRejected()
    {
        Assert.Equal("OVL_API_INVALID_DOCUMENT", (await Service().SaveDraftAsync(CarId, _driver, "{"u8.ToArray(), 0)).Error?.Code);
        var v2 = Encoding.UTF8.GetBytes("""{"schemaVersion":2,"workspace":{"width":1,"height":1},"elements":{},"children":[]}""");
        Assert.Equal("OVL_API_SCHEMA_UNSUPPORTED", (await Service().SaveDraftAsync(CarId, _driver, v2, 0)).Error?.Code);
    }

    [Fact]
    public async Task OversizedDocumentsAreRejected()
    {
        var big = new byte[OverlayService.MaxDocumentBytes + 1];
        Assert.Equal(413, (await Service().SaveDraftAsync(CarId, _driver, big, 0)).Error?.Status);
    }

    [Fact]
    public async Task OnlyTheLastFiftyRevisionsAreKept()
    {
        long revision = 0;
        for (var i = 0; i < 55; i++) revision = await SaveAsync(Doc(), revision);
        var kept = await _ctx.OverlayDraftRevisions.Where(r => r.CarId == CarId).Select(r => r.Revision).OrderBy(r => r).ToListAsync();
        Assert.Equal(50, kept.Count);
        Assert.Equal(6, kept[0]);
        Assert.Equal(55, kept[^1]);
    }

    // --- Patch ---

    [Fact]
    public async Task PatchAppliesToTheBaseRevision()
    {
        await SaveAsync(Doc());
        var patch = Encoding.UTF8.GetBytes("""[{"op":"add","path":"/elements/e_a","value":{"type":"rect"}},{"op":"replace","path":"/children","value":["e_a"]}]""");
        var result = await Service().PatchDraftAsync(CarId, _driver, patch, 1);
        Assert.Equal(2, result.Value?.Revision);
        var draft = (await Service().GetDraftAsync(CarId, _driver)).Value!;
        Assert.Equal("rect", draft.Document["elements"]!["e_a"]!["type"]!.GetValue<string>());
        Assert.Equal(409, (await Service().PatchDraftAsync(CarId, _driver, patch, 1)).Error?.Status);
    }

    [Fact]
    public async Task PatchOnTheStartDocumentCreatesTheDraft()
    {
        var patch = Encoding.UTF8.GetBytes("""[{"op":"replace","path":"/workspace/width","value":800}]""");
        Assert.Equal(1, (await Service().PatchDraftAsync(CarId, _driver, patch, 0)).Value?.Revision);
    }

    [Fact]
    public async Task UnusablePatchesFail()
    {
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

    [Fact]
    public async Task PublishingCreatesNumberedImmutableStates()
    {
        await SaveAsync(Doc(Speed, """["e_v"]"""));
        var first = await Service().PublishAsync(CarId, _driver, 1, "erste Version");
        Assert.Equal(1, first.Value?.Number);
        Assert.Contains(first.Value!.Warnings, d => d.Code == "OVL_EXPR_UNCHECKED");

        await SaveAsync(Doc(), 1);
        var published = (await Service().GetPublishedAsync(CarId)).Value!;
        Assert.Equal(1, published.Number);
        Assert.NotNull(published.Document["elements"]!["e_v"]);

        Assert.Equal(2, (await Service().PublishAsync(CarId, _driver, 2, null)).Value?.Number);
        var history = (await Service().ListPublicationsAsync(CarId, _driver)).Value!;
        Assert.Equal([2, 1], history.Select(h => h.Number));
        Assert.Equal("erste Version", history[1].Note);
        Assert.Equal("driver", history[1].PublishedBy);
        Assert.Equal([1, 2], _events.Publications.Select(p => p.Number));
    }

    [Fact]
    public async Task PublishingRequiresTheCurrentRevision()
    {
        Assert.Equal(409, (await Service().PublishAsync(CarId, _driver, 0, null)).Error?.Status);
        await SaveAsync(Doc());
        await SaveAsync(Doc(), 1);
        Assert.Equal("OVL_API_REVISION_CONFLICT", (await Service().PublishAsync(CarId, _driver, 1, null)).Error?.Code);
    }

    [Fact]
    public async Task PublishErrorsBlockPublishing()
    {
        await SaveAsync(Doc("""{"e_l":{"type":"lidarWidget","source":"nope"}}""", """["e_l"]"""));
        var result = await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Equal("OVL_API_PUBLISH_BLOCKED", result.Error?.Code);
        Assert.Contains(result.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE");
        Assert.Null((await Service().GetPublishedAsync(CarId)).Value);
    }

    [Fact]
    public async Task DisabledPartsOnlyWarn()
    {
        await SaveAsync(Doc("""{"e_l":{"type":"lidarWidget","source":"nope","disabled":true}}""", """["e_l"]"""));
        Assert.Equal(1, (await Service().PublishAsync(CarId, _driver, 1, null)).Value?.Number);
    }

    [Fact]
    public async Task NoteIsLimited()
    {
        await SaveAsync(Doc());
        Assert.Equal(400, (await Service().PublishAsync(CarId, _driver, 1, new string('x', 501))).Error?.Status);
    }

    [Fact]
    public async Task RestoreLoadsAPublicationAsDraftWithoutPublishing()
    {
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

    // --- Assets ---

    [Fact]
    public async Task UploadsAreRefusedWithoutSanitizer()
    {
        var service = new OverlayService(_ctx, new OverlayAccess(_ctx), new UnavailableSvgAssetSanitizer(), _events, _time);
        Assert.Equal("OVL_API_NOT_AVAILABLE", (await service.UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Error?.Code);
        Assert.Empty(_ctx.OverlayAssets);
    }

    [Fact]
    public async Task UploadRequiresAdminAndRespectsLimitsAndRejections()
    {
        Assert.Equal(401, (await Service().UploadAssetAsync(CarId, _guest, "<svg/>"u8.ToArray())).Error?.Status);
        Assert.Equal(413, (await Service().UploadAssetAsync(CarId, _driver, new byte[OverlayService.MaxAssetBytes + 1])).Error?.Status);
        _sanitizer.Reject = true;
        Assert.Equal("OVL_API_ASSET_REJECTED", (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Error?.Code);
    }

    [Fact]
    public async Task AssetLifecycleFollowsReferences()
    {
        var upload = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        var element = "{\"e_s\":{\"type\":\"svgAsset\",\"assetId\":\"" + upload.AssetId + "\",\"parts\":{\"p_1\":{\"props\":{\"opacity\":0.5}}}}}";
        Assert.Equal(OverlayAssetStatus.Pending, _ctx.OverlayAssets.AsNoTracking().Single().Status);

        // Viewers only see published assets; the administrator sees all.
        Assert.Equal(404, (await Service().GetAssetAsync(CarId, upload.AssetId, null)).Error?.Status);
        Assert.Equal("<svg/>", (await Service().GetAssetAsync(CarId, upload.AssetId, _driver)).Value);

        await SaveAsync(Doc(element, """["e_s"]"""));
        Assert.Equal(OverlayAssetStatus.Active, _ctx.OverlayAssets.AsNoTracking().Single().Status);
        await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Equal("<svg/>", (await Service().GetAssetAsync(CarId, upload.AssetId, null)).Value);

        // Removed from the draft, the asset stays: a kept revision and the publication still use it.
        long revision = 1;
        for (var i = 0; i < 55; i++) revision = await SaveAsync(Doc(), revision);
        Assert.Single(_ctx.OverlayAssets.AsNoTracking());
    }

    [Fact]
    public async Task UnreferencedAssetsAreCollected()
    {
        var pending = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        _sanitizer.Next = "<svg id='2'/>";
        var used = (await Service().UploadAssetAsync(CarId, _driver, "<svg/>"u8.ToArray())).Value!;
        var element = $$$"""{"e_s":{"type":"svgAsset","assetId":"{{{used.AssetId}}}"}}""";
        var revision = await SaveAsync(Doc(element, """["e_s"]"""));

        await Service().CollectGarbageAsync(CarId);
        Assert.Equal(2, _ctx.OverlayAssets.AsNoTracking().Count());

        _time.Advance(TimeSpan.FromHours(25));
        await Service().CollectGarbageAsync(CarId);
        Assert.Equal([used.AssetId], _ctx.OverlayAssets.AsNoTracking().Select(a => a.AssetId));
        Assert.NotEqual(pending.AssetId, used.AssetId);

        // Once no revision refers to it any more, an active asset goes too.
        for (var i = 0; i < 50; i++) revision = await SaveAsync(Doc(), revision);
        Assert.Empty(_ctx.OverlayAssets.AsNoTracking());
    }

    [Fact]
    public async Task UnknownAssetsBlockPublishing()
    {
        await SaveAsync(Doc($$$"""{"e_s":{"type":"svgAsset","assetId":"sha256-{{{new string('a', 64)}}}"}}""", """["e_s"]"""));
        var result = await Service().PublishAsync(CarId, _driver, 1, null);
        Assert.Contains(result.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_ASSET");
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
        public string Next = "<svg/>";
        public bool IsAvailable => true;

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
