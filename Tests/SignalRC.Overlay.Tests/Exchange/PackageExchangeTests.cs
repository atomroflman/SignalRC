using System.Text;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Overlay.Tests.Testing;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Overlay.Assets;
using SignalRC.Server.Overlay.Expressions;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Exchange;

public sealed class SqlitePackageExchangeTests() : PackageExchangeTests(new SqliteOverlayTestDb());

/// <summary>Runs only with SIGNALRC_TEST_POSTGRES set; see PostgresOverlayTestDb.</summary>
public sealed class PostgresPackageExchangeTests() : PackageExchangeTests(PostgresOverlayTestDb.FromEnvironment());

/// <summary>
/// AP12: the exchange package of Shared/Overlay/fixtures/exchange/roundtrip.json
/// through the real sanitizer and the overlay service. Re-imported assets keep
/// their ids and parts; unresolved active references block publishing; the
/// mapped document (computed by the client, checked there) publishes.
/// </summary>
public abstract class PackageExchangeTests : IDisposable
{
    private readonly IOverlayTestDb? _db;
    private readonly SignalRCContext _ctx = null!;
    private readonly User _driver = null!;
    private readonly JsonNode _fixture = Contracts.ReadJson("fixtures/exchange/roundtrip.json")!;
    private int CarId { get; }

    protected PackageExchangeTests(IOverlayTestDb? db)
    {
        _db = db;
        if (db == null) return;
        _ctx = db.Create();
        var tag = Guid.NewGuid().ToString("N")[..12];
        var car = new Car { Name = $"overlay-exchange-{tag}", CarIdentityKey = $"overlay-exchange-{tag}", LastSeen = DateTime.UtcNow };
        _ctx.Cars.Add(car);
        _ctx.SaveChanges();
        CarId = car.Id;
        _driver = new User
        {
            Name = $"Driver-{tag}", LoginName = $"driver-{tag}", ActiveVehicleId = CarId,
            SessionId = Random.Shared.NextInt64(1_000_000_000_000, 9_000_000_000_000), LastSeen = DateTime.UtcNow,
        };
        _ctx.Users.Add(_driver);
        _ctx.SaveChanges();
        _ctx.UserSetups.Add(new UserCarSetup { UserId = _driver.Id, CarId = CarId });
        // The fixture's target vehicle (streams are only a warning and stay out: StreamIds are global).
        _ctx.CarTelemetry.AddRange(
            new CarTelemetry { CarId = CarId, ChannelName = "odoSpeed", DataType = TelemetryDataType.Number, TelemetryType = "x", PinManager = "x" },
            new CarTelemetry { CarId = CarId, ChannelName = "lidarGrid", DataType = TelemetryDataType.LidarGrid, TelemetryType = "x", PinManager = "x" });
        _ctx.CarChannels.Add(new CarChannel { CarId = CarId, ChannelName = "steering" });
        _ctx.SaveChanges();
    }

    public void Dispose()
    {
        if (_db == null) return;
        _ctx.Dispose();
        using (var cleanup = _db.Create())
        {
            cleanup.UserSetups.Where(s => s.CarId == CarId).ExecuteDelete();
            cleanup.Users.Where(u => u.Id == _driver.Id).ExecuteDelete();
            cleanup.CarTelemetry.Where(t => t.CarId == CarId).ExecuteDelete();
            cleanup.CarChannels.Where(c => c.CarId == CarId).ExecuteDelete();
            cleanup.Cars.Where(c => c.Id == CarId).ExecuteDelete();
        }
        _db.Dispose();
        GC.SuppressFinalize(this);
    }

    private void Require() => Skip.If(_db == null, $"{PostgresOverlayTestDb.Variable} ist nicht gesetzt");

    private OverlayService Service() =>
        new(_ctx, new OverlayAccess(_ctx), new SvgAssetSanitizer(), new NoNotifier(), TimeProvider.System, ExpressionAnalyzer.Instance);

    private static byte[] Bytes(JsonNode? node) => Encoding.UTF8.GetBytes(node!.ToJsonString());

    /// <summary>Import step 2: every referenced asset goes through the normal upload again.</summary>
    private async Task<Dictionary<string, AssetUpload>> UploadAssetsAsync()
    {
        var uploads = new Dictionary<string, AssetUpload>();
        foreach (var (id, entry) in _fixture["package"]!["assets"]!.AsObject())
        {
            if (id == _fixture["unreferencedAssetId"]!.GetValue<string>()) continue;
            var svg = entry!["svg"]!.GetValue<string>();
            var result = await Service().UploadAssetAsync(CarId, _driver, Encoding.UTF8.GetBytes(svg));
            Assert.Null(result.Error);
            uploads[id] = result.Value!;
        }
        return uploads;
    }

    [SkippableFact]
    public async Task ReimportedAssetsKeepIdsSvgAndParts()
    {
        Require();
        var uploads = await UploadAssetsAsync();
        Assert.Equal(2, uploads.Count);
        foreach (var (id, upload) in uploads)
        {
            Assert.Equal(id, upload.AssetId);
            Assert.Equal(_fixture["package"]!["assets"]![id]!["svg"]!.GetValue<string>(), upload.Svg);
            Assert.Empty(upload.Report);
        }
        // Part ids the document refers to survive (data-part is the source id).
        var doc = _fixture["package"]!["document"]!;
        foreach (var element in doc["elements"]!.AsObject().Select(e => e.Value!).Where(e => e["assetId"] != null))
        {
            var parts = uploads[element["assetId"]!.GetValue<string>()].Metadata["parts"]!.AsObject();
            foreach (var (part, _) in element["parts"]!.AsObject()) Assert.True(parts.ContainsKey(part), part);
        }
    }

    [SkippableFact]
    public async Task UnresolvedActiveReferencesBlockPublishingTheMappedDocumentPublishes()
    {
        Require();
        await UploadAssetsAsync();

        // Imported as is: saving works, publishing is blocked by the foreign channel names.
        var saved = await Service().SaveDraftAsync(CarId, _driver, Bytes(_fixture["package"]!["document"]), 0);
        Assert.Null(saved.Error);
        var blocked = await Service().PublishAsync(CarId, _driver, saved.Value!.Revision, null);
        Assert.Equal("OVL_API_PUBLISH_BLOCKED", blocked.Error?.Code);
        Assert.Contains(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE" && d.Location.Element == "e_speed");
        Assert.Contains(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_SOURCE" && d.Location.Element == "e_scan");
        Assert.DoesNotContain(blocked.Error!.Diagnostics!, d => d.Code == "OVL_REF_UNKNOWN_ASSET");

        // After the mapping only the disabled element keeps its reference (warning).
        var mapped = await Service().SaveDraftAsync(CarId, _driver, Bytes(_fixture["expected"]), saved.Value!.Revision);
        Assert.Null(mapped.Error);
        var published = await Service().PublishAsync(CarId, _driver, mapped.Value!.Revision, null);
        Assert.Null(published.Error);
        Assert.Contains(published.Value!.Warnings, d => d.Code == "OVL_REF_UNKNOWN_SOURCE" && d.Location.Element == "e_old");

        var current = (await Service().GetPublishedAsync(CarId)).Value!;
        Assert.True(JsonNode.DeepEquals(_fixture["expected"], current.Document));
        var referenced = _fixture["package"]!["assets"]!.AsObject().Select(a => a.Key)
            .Where(id => id != _fixture["unreferencedAssetId"]!.GetValue<string>()).OrderBy(x => x, StringComparer.Ordinal);
        Assert.Equal(referenced, current.Assets.Select(a => a.Key).OrderBy(x => x, StringComparer.Ordinal));
    }

    private sealed class NoNotifier : IOverlayNotifier
    {
        public Task DraftChangedAsync(int carId, long revision) => Task.CompletedTask;
        public Task PublishedAsync(int carId, int publicationId, int number) => Task.CompletedTask;
    }
}
