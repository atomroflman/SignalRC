using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay.Documents;
using SharedDataType = SignalRC.Shared.Channels.TelemetryDataType;

namespace SignalRC.Server.Overlay;

/// <summary>A failed overlay operation as described by the API contract §3.</summary>
public sealed record OverlayError(
    string Code,
    int Status,
    string Title,
    IReadOnlyList<Diagnostic>? Diagnostics = null,
    long? CurrentRevision = null,
    JsonArray? Report = null);

public sealed class OverlayResult<T>
{
    public T? Value { get; private init; }
    public OverlayError? Error { get; private init; }

    public static implicit operator OverlayResult<T>(T value) => new() { Value = value };
    public static implicit operator OverlayResult<T>(OverlayError error) => new() { Error = error };
}

/// <param name="Assets">Stored metadata of the vehicle's assets the draft references, by asset id.</param>
public sealed record DraftInfo(long Revision, JsonNode Document, DateTime? UpdatedAt, string? UpdatedBy, JsonObject Assets);
public sealed record SavedDraft(long Revision);
/// <param name="Assets">Normalized metadata (size, parts with bbox) of the publication's asset set, by asset id.</param>
public sealed record PublishedInfo(int PublicationId, int Number, DateTime PublishedAt, JsonNode Document, JsonObject Assets);
public sealed record PublicationInfo(int Id, int Number, DateTime PublishedAt, string? PublishedBy, string? Note);
public sealed record PublicationResult(int PublicationId, int Number, IReadOnlyList<Diagnostic> Warnings);
public sealed record AssetUpload(string AssetId, JsonObject Metadata, string Svg, JsonArray Report);
/// <param name="Kind">"telemetry" (tel(), LiDAR source, staleness override) or "output" (out()).</param>
public sealed record ChannelReference(string Kind, DiagnosticLocation Location);
public sealed record ChannelDependencies(IReadOnlyList<ChannelReference> Draft, IReadOnlyList<ChannelReference> Published);

/// <summary>
/// Overlay draft, publications and assets of a vehicle
/// (Shared/Overlay/api/README.md). Controllers stay thin; every rule lives here.
/// </summary>
public sealed class OverlayService(
    SignalRCContext db,
    OverlayAccess access,
    ISvgAssetSanitizer sanitizer,
    IOverlayNotifier notifier,
    TimeProvider time,
    IExpressionAnalyzer? expressions = null)
{
    public const int MaxDocumentBytes = 2 * 1024 * 1024;
    public const int MaxAssetBytes = 256 * 1024;
    public const int KeptRevisions = 50;
    public const int MaxNoteLength = 500;
    private static readonly TimeSpan PendingAssetLifetime = TimeSpan.FromHours(24);

    private DateTime Now => time.GetUtcNow().UtcDateTime;

    // --- Errors ---

    private static OverlayError AccessError(OverlayAccessError error) => error switch
    {
        OverlayAccessError.LoginRequired => new("OVL_API_LOGIN_REQUIRED", 401, "Anmeldung erforderlich"),
        OverlayAccessError.NoCarAccess => new("OVL_API_NO_CAR_ACCESS", 403, "Kein Zugang zu diesem Fahrzeug"),
        _ => new("OVL_API_NOT_DRIVER", 403, "Nur der aktive Fahrer darf das Overlay verwalten"),
    };

    private static OverlayError NotFound(string what) => new("OVL_API_NOT_FOUND", 404, what);

    private static OverlayError Conflict(long current) =>
        new("OVL_API_REVISION_CONFLICT", 409, "Der Entwurf wurde inzwischen geändert", CurrentRevision: current);

    private async Task<OverlayError?> RequireAdminAsync(User? user, int carId)
    {
        if (!await db.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Fahrzeug nicht gefunden");
        var error = await access.CheckAdminAsync(user, carId);
        return error == OverlayAccessError.None ? null : AccessError(error);
    }

    // --- Read ---

    public async Task<OverlayResult<PublishedInfo?>> GetPublishedAsync(int carId)
    {
        if (!await access.CanViewCarAsync(carId)) return NotFound("Fahrzeug nicht gefunden");
        var publication = await db.OverlayPublications.AsNoTracking()
            .Where(p => p.CarId == carId).OrderByDescending(p => p.Number).FirstOrDefaultAsync();
        return publication == null
            ? (PublishedInfo?)null
            : new PublishedInfo(publication.Id, publication.Number, publication.PublishedAt, JsonNode.Parse(publication.DocumentJson)!,
                await PublicationAssetMetadataAsync(carId, publication.Id));
    }

    public async Task<OverlayResult<DraftInfo>> GetDraftAsync(int carId, User? user)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        var draft = await db.OverlayDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.CarId == carId);
        if (draft == null) return new DraftInfo(0, await StartDocumentAsync(carId), null, null, new JsonObject());
        var by = draft.UpdatedByUserId == null ? null
            : await db.Users.Where(u => u.Id == draft.UpdatedByUserId).Select(u => u.LoginName ?? u.Name).FirstOrDefaultAsync();
        var document = JsonNode.Parse(draft.DocumentJson)!;
        var ids = AssetIds(document).ToList();
        return new DraftInfo(draft.Revision, document, draft.UpdatedAt, by,
            await AssetMetadataAsync(carId, db.OverlayAssets.Where(a => ids.Contains(a.AssetId)).Select(a => a.AssetId)));
    }

    /// <summary>Empty document whose workspace follows the first stream (D22).</summary>
    private async Task<JsonObject> StartDocumentAsync(int carId)
    {
        var stream = await db.CarVideoStreams.AsNoTracking().Where(s => s.CarId == carId)
            .OrderBy(s => s.Priority).ThenBy(s => s.Name).FirstOrDefaultAsync();
        var (width, height) = stream is { Width: > 0, Height: > 0 } ? (stream.Width, stream.Height) : (1920, 1080);
        return new JsonObject
        {
            ["schemaVersion"] = 1,
            ["workspace"] = new JsonObject { ["width"] = width, ["height"] = height },
            ["elements"] = new JsonObject(),
            ["children"] = new JsonArray(),
        };
    }

    public async Task<OverlayResult<IReadOnlyList<PublicationInfo>>> ListPublicationsAsync(int carId, User? user)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        var list = await db.OverlayPublications.AsNoTracking().Where(p => p.CarId == carId)
            .OrderByDescending(p => p.Number)
            .Select(p => new PublicationInfo(p.Id, p.Number, p.PublishedAt, p.PublishedByName, p.Note))
            .ToListAsync();
        return list;
    }

    public async Task<OverlayResult<PublishedInfo>> GetPublicationAsync(int carId, int publicationId, User? user)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        var p = await db.OverlayPublications.AsNoTracking().FirstOrDefaultAsync(x => x.Id == publicationId && x.CarId == carId);
        if (p == null) return NotFound("Veröffentlichung nicht gefunden");
        return new PublishedInfo(p.Id, p.Number, p.PublishedAt, JsonNode.Parse(p.DocumentJson)!, await PublicationAssetMetadataAsync(carId, p.Id));
    }

    /// <summary>
    /// Metadata of the assets a publication references (api §3): viewers need the
    /// part bboxes for "center" pivots, but read only the SVG text from GET assets.
    /// </summary>
    private Task<JsonObject> PublicationAssetMetadataAsync(int carId, int publicationId) =>
        AssetMetadataAsync(carId, db.OverlayPublicationAssets.Where(pa => pa.PublicationId == publicationId).Select(pa => pa.AssetId));

    /// <summary>Stored metadata of the vehicle's assets among <paramref name="ids"/>; missing or unreadable metadata is left out.</summary>
    private async Task<JsonObject> AssetMetadataAsync(int carId, IQueryable<string> ids)
    {
        var rows = await db.OverlayAssets.AsNoTracking().Where(a => a.CarId == carId && ids.Contains(a.AssetId))
            .OrderBy(a => a.AssetId).Select(a => new { a.AssetId, a.MetadataJson }).ToListAsync();
        var result = new JsonObject();
        foreach (var row in rows)
        {
            JsonNode? meta = null;
            try { meta = string.IsNullOrEmpty(row.MetadataJson) ? null : JsonNode.Parse(row.MetadataJson); }
            catch (System.Text.Json.JsonException) { /* unreadable metadata: the client falls back to the SVG viewBox */ }
            if (meta is JsonObject) result[row.AssetId] = meta;
        }
        return result;
    }

    /// <summary>
    /// Where the draft and the current publication use a channel, for the
    /// warning before deleting or renaming it. Historic publications are not
    /// listed: they are never rewritten.
    /// </summary>
    public async Task<OverlayResult<ChannelDependencies>> GetDependenciesAsync(int carId, User? user, string channel)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        var draft = await db.OverlayDrafts.AsNoTracking().Where(d => d.CarId == carId).Select(d => d.DocumentJson).FirstOrDefaultAsync();
        var published = await db.OverlayPublications.AsNoTracking().Where(p => p.CarId == carId)
            .OrderByDescending(p => p.Number).Select(p => p.DocumentJson).FirstOrDefaultAsync();
        return new ChannelDependencies(References(draft, channel), References(published, channel));
    }

    private static IReadOnlyList<ChannelReference> References(string? json, string channel)
    {
        if (json == null || JsonNode.Parse(json) is not JsonObject doc) return [];
        return DocumentResolver.SourceReferences(doc)
            .Where(r => r.Name == channel && r.Kind is Expressions.SourceKind.Tel or Expressions.SourceKind.Out)
            .Select(r => new ChannelReference(r.Kind == Expressions.SourceKind.Tel ? "telemetry" : "output", r.Location))
            .ToList();
    }

    // --- Draft writes ---

    /// <summary>Saves a whole document (PUT draft). <paramref name="body"/> is the raw request body.</summary>
    public async Task<OverlayResult<SavedDraft>> SaveDraftAsync(int carId, User? user, byte[] body, long baseRevision)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        if (body.Length > MaxDocumentBytes) return TooLarge();
        JsonNode? doc;
        try
        {
            doc = JsonNode.Parse(body);
        }
        catch (JsonException)
        {
            return InvalidJson();
        }
        return await StoreAsync(carId, user!, doc, baseRevision);
    }

    /// <summary>Applies a JSON Patch to the draft at <paramref name="baseRevision"/> (PATCH draft, D63).</summary>
    public async Task<OverlayResult<SavedDraft>> PatchDraftAsync(int carId, User? user, byte[] body, long baseRevision)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        if (body.Length > MaxDocumentBytes) return TooLarge();
        JsonArray patch;
        try
        {
            patch = JsonNode.Parse(body) as JsonArray ?? throw new JsonException();
        }
        catch (JsonException)
        {
            return PatchFailed("Kein gültiger JSON-Patch");
        }
        var draft = await db.OverlayDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.CarId == carId);
        var current = draft?.Revision ?? 0;
        if (current != baseRevision) return Conflict(current);
        var basis = draft == null ? await StartDocumentAsync(carId) : JsonNode.Parse(draft.DocumentJson)!;
        JsonNode patched;
        try
        {
            patched = JsonPatch.Apply(basis, patch);
        }
        catch (JsonPatch.PatchException e)
        {
            return PatchFailed(e.Message);
        }
        if (Encoding.UTF8.GetByteCount(patched.ToJsonString()) > MaxDocumentBytes) return TooLarge();
        return await StoreAsync(carId, user!, patched, baseRevision);
    }

    public async Task<OverlayResult<SavedDraft>> RestoreAsync(int carId, User? user, int publicationId, long baseRevision)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        var publication = await db.OverlayPublications.AsNoTracking().FirstOrDefaultAsync(p => p.Id == publicationId && p.CarId == carId);
        if (publication == null) return NotFound("Veröffentlichung nicht gefunden");
        return await StoreAsync(carId, user!, JsonNode.Parse(publication.DocumentJson), baseRevision);
    }

    private static OverlayError TooLarge() => new("OVL_API_TOO_LARGE", 413, "Dokument größer als 2 MB");

    private static OverlayError PatchFailed(string detail) => new("OVL_API_PATCH_FAILED", 422, $"Patch nicht anwendbar: {detail}");

    private static OverlayError InvalidJson() => new("OVL_API_INVALID_DOCUMENT", 422, "Kein gültiges JSON",
        [new Diagnostic("OVL_SCHEMA_INVALID", DiagnosticCategory.Structure, DiagnosticSeverity.Error,
            new DiagnosticLocation { Path = "" }, "Kein gültiges JSON")]);

    /// <summary>
    /// Validates for saving (structure only blocks) and stores a new revision
    /// if the draft is still at <paramref name="baseRevision"/>.
    /// </summary>
    private async Task<OverlayResult<SavedDraft>> StoreAsync(int carId, User user, JsonNode? doc, long baseRevision)
    {
        var diagnostics = DocumentResolver.Validate(doc, await ContextAsync(carId));
        if (diagnostics.Any(d => d.Code == "OVL_SCHEMA_UNSUPPORTED"))
        {
            return new OverlayError("OVL_API_SCHEMA_UNSUPPORTED", 422, "Schema-Version wird nicht unterstützt", diagnostics);
        }
        var blocking = diagnostics.Where(d => d.Category == DiagnosticCategory.Structure).ToList();
        if (blocking.Count > 0) return new OverlayError("OVL_API_INVALID_DOCUMENT", 422, "Dokument ist strukturell ungültig", blocking);

        var json = doc!.ToJsonString();
        var revision = baseRevision + 1;
        var stored = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            // The retrying strategy may run this again; start from a clean tracker.
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            if (baseRevision == 0)
            {
                if (await db.OverlayDrafts.AnyAsync(d => d.CarId == carId)) return false;
                db.OverlayDrafts.Add(new OverlayDraft
                {
                    CarId = carId, Revision = revision, DocumentJson = json, UpdatedAt = Now, UpdatedByUserId = user.Id,
                });
            }
            else
            {
                // Compare-and-set: only one writer can move the draft from baseRevision.
                var updated = await db.OverlayDrafts
                    .Where(d => d.CarId == carId && d.Revision == baseRevision)
                    .ExecuteUpdateAsync(s => s
                        .SetProperty(d => d.Revision, revision)
                        .SetProperty(d => d.DocumentJson, json)
                        .SetProperty(d => d.UpdatedAt, Now)
                        .SetProperty(d => d.UpdatedByUserId, user.Id));
                if (updated == 0) return false;
            }
            db.OverlayDraftRevisions.Add(new OverlayDraftRevision
            {
                CarId = carId, Revision = revision, DocumentJson = json, CreatedAt = Now, UserId = user.Id,
            });
            await db.OverlayDraftRevisions.Where(r => r.CarId == carId && r.Revision <= revision - KeptRevisions).ExecuteDeleteAsync();
            await ActivateAsync(carId, AssetIds(doc));
            try
            {
                await db.SaveChangesAsync();
            }
            catch (DbUpdateException)
            {
                // A concurrent first save inserted the draft (unique CarId).
                db.ChangeTracker.Clear();
                return false;
            }
            await transaction.CommitAsync();
            return true;
        });
        if (!stored)
        {
            var current = await db.OverlayDrafts.Where(d => d.CarId == carId).Select(d => (long?)d.Revision).FirstOrDefaultAsync() ?? 0;
            return Conflict(current);
        }
        await notifier.DraftChangedAsync(carId, revision);
        await CollectGarbageAsync(carId);
        return new SavedDraft(revision);
    }

    // --- Publishing ---

    public async Task<OverlayResult<PublicationResult>> PublishAsync(int carId, User? user, long baseRevision, string? note)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        if (note is { Length: > MaxNoteLength })
        {
            return new OverlayError("OVL_API_INVALID_REQUEST", 400, "Notiz länger als 500 Zeichen");
        }
        var draft = await db.OverlayDrafts.AsNoTracking().FirstOrDefaultAsync(d => d.CarId == carId);
        var current = draft?.Revision ?? 0;
        if (draft == null || current != baseRevision) return Conflict(current);

        var doc = JsonNode.Parse(draft.DocumentJson);
        var diagnostics = DocumentResolver.Validate(doc, await ContextAsync(carId)).ToList();
        if (expressions == null && ContainsFormulas(doc))
        {
            // D66: until AP06 is registered, formulas are published unchecked with a warning.
            diagnostics.Add(new Diagnostic("OVL_EXPR_UNCHECKED", DiagnosticCategory.Warning, DiagnosticSeverity.Warning,
                DiagnosticLocation.Empty, "Formeln wurden nicht geprüft (Formelprüfung noch nicht verfügbar)"));
        }
        if (!DocumentResolver.CanPublish(diagnostics))
        {
            return new OverlayError("OVL_API_PUBLISH_BLOCKED", 422, "Veröffentlichung blockiert", diagnostics);
        }

        var assetIds = AssetIds(doc);
        var publisher = user!.LoginName ?? user.Name;
        var publication = await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var transaction = await db.Database.BeginTransactionAsync();
            // A no-op update locks the draft row until commit, so publishes of a
            // vehicle run one after another and each sees the previous number.
            // It also re-checks the revision under that lock.
            var locked = await db.OverlayDrafts
                .Where(d => d.CarId == carId && d.Revision == baseRevision)
                .ExecuteUpdateAsync(u => u.SetProperty(d => d.Revision, d => d.Revision));
            if (locked == 0) return null;
            var number = (await db.OverlayPublications.Where(p => p.CarId == carId).MaxAsync(p => (int?)p.Number) ?? 0) + 1;
            var entity = new OverlayPublication
            {
                CarId = carId,
                Number = number,
                SchemaVersion = 1,
                DocumentJson = draft.DocumentJson,
                PublishedAt = Now,
                PublishedByUserId = user.Id,
                PublishedByName = publisher,
                Note = string.IsNullOrWhiteSpace(note) ? null : note,
                SourceDraftRevision = baseRevision,
                Assets = assetIds.Select(id => new OverlayPublicationAsset { AssetId = id }).ToList(),
            };
            db.OverlayPublications.Add(entity);
            await ActivateAsync(carId, assetIds);
            await db.SaveChangesAsync();
            await transaction.CommitAsync();
            return (OverlayPublication?)entity;
        });
        if (publication == null)
        {
            var now = await db.OverlayDrafts.Where(d => d.CarId == carId).Select(d => (long?)d.Revision).FirstOrDefaultAsync() ?? 0;
            return Conflict(now);
        }
        await notifier.PublishedAsync(carId, publication.Id, publication.Number);
        return new PublicationResult(publication.Id, publication.Number,
            diagnostics.Where(d => d.Category == DiagnosticCategory.Warning).ToList());
    }

    private static bool ContainsFormulas(JsonNode? node) => node switch
    {
        JsonObject o => o.Any(p =>
            (p.Key is "binding" or "rate" && p.Value is JsonObject) ||
            (p.Key == "trigger" && p.Value is JsonObject t && t.ContainsKey("condition")) ||
            ContainsFormulas(p.Value)),
        JsonArray a => a.Any(ContainsFormulas),
        _ => false,
    };

    // --- Validation context from the vehicle's configuration ---

    private async Task<ResolveContext> ContextAsync(int carId)
    {
        var streams = await db.CarVideoStreams.AsNoTracking().Where(s => s.CarId == carId).Select(s => s.StreamId).ToListAsync();
        var telemetry = await db.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId)
            .Select(t => new { t.ChannelName, t.DataType }).ToListAsync();
        var outputs = await db.CarChannels.AsNoTracking().Where(c => c.CarId == carId).Select(c => c.ChannelName).ToListAsync();
        var assets = await db.OverlayAssets.AsNoTracking().Where(a => a.CarId == carId)
            .Select(a => new { a.AssetId, a.MetadataJson, a.Svg }).ToListAsync();
        return new ResolveContext
        {
            Streams = streams,
            Sources = new SourceCatalog(
                telemetry.GroupBy(t => t.ChannelName).ToDictionary(g => g.Key, g => DataType(g.First().DataType)),
                outputs),
            Assets = assets.ToDictionary(a => a.AssetId, a => Metadata(a.MetadataJson, Encoding.UTF8.GetByteCount(a.Svg))),
            Expressions = expressions,
        };
    }

    private static Documents.TelemetryDataType DataType(SharedDataType type) => type switch
    {
        SharedDataType.Integer => Documents.TelemetryDataType.Integer,
        SharedDataType.Number => Documents.TelemetryDataType.Number,
        SharedDataType.Boolean => Documents.TelemetryDataType.Boolean,
        _ when type.ToString() == "LidarGrid" => Documents.TelemetryDataType.LidarGrid,
        _ => Documents.TelemetryDataType.String,
    };

    private static AssetMetadata Metadata(string json, long size)
    {
        var node = JsonNode.Parse(json) as JsonObject ?? new JsonObject();
        var parts = new Dictionary<string, AssetPart>();
        if (node["parts"] is JsonObject p)
        {
            foreach (var (id, part) in p)
            {
                var bbox = (part?["bbox"] as JsonArray)?.Select(v => v?.GetValue<double>() ?? 0).ToArray() ?? [0, 0, 0, 0];
                parts[id] = new AssetPart(part?["tag"]?.GetValue<string>() ?? "", bbox);
            }
        }
        return new AssetMetadata(node["width"]?.GetValue<double>() ?? 0, node["height"]?.GetValue<double>() ?? 0, parts, size);
    }

    // --- Assets ---

    public async Task<OverlayResult<AssetUpload>> UploadAssetAsync(int carId, User? user, byte[] raw)
    {
        if (await RequireAdminAsync(user, carId) is { } error) return error;
        if (!sanitizer.IsAvailable)
        {
            return new OverlayError("OVL_API_NOT_AVAILABLE", 501, "SVG-Import ist noch nicht verfügbar");
        }
        if (raw.Length > MaxAssetBytes)
        {
            return new OverlayError("OVL_API_TOO_LARGE", 413, "SVG größer als 256 kB");
        }
        var result = sanitizer.Sanitize(raw);
        if (!result.Accepted || result.AssetId == null || result.Svg == null || result.Metadata == null)
        {
            return new OverlayError("OVL_API_ASSET_REJECTED", 422, "SVG abgelehnt", Report: result.Report);
        }
        var existing = await db.OverlayAssets.AsNoTracking().FirstOrDefaultAsync(a => a.CarId == carId && a.AssetId == result.AssetId);
        if (existing == null)
        {
            db.OverlayAssets.Add(new OverlayAsset
            {
                CarId = carId,
                AssetId = result.AssetId,
                Svg = result.Svg,
                MetadataJson = result.Metadata.ToJsonString(),
                Status = OverlayAssetStatus.Pending,
                CreatedAt = Now,
                CreatedByUserId = user!.Id,
            });
            await db.SaveChangesAsync();
        }
        return new AssetUpload(result.AssetId, result.Metadata, result.Svg, result.Report);
    }

    /// <summary>Viewers get assets of published states only; the administrator every asset of the vehicle.</summary>
    public async Task<OverlayResult<string>> GetAssetAsync(int carId, string assetId, User? user)
    {
        var asset = await db.OverlayAssets.AsNoTracking().FirstOrDefaultAsync(a => a.CarId == carId && a.AssetId == assetId);
        if (asset == null) return NotFound("Asset nicht gefunden");
        var published = await db.OverlayPublicationAssets.AnyAsync(pa => pa.AssetId == assetId && pa.Publication.CarId == carId);
        if (published && await access.CanViewCarAsync(carId)) return asset.Svg;
        if (await access.CheckAdminAsync(user, carId) == OverlayAccessError.None) return asset.Svg;
        return NotFound("Asset nicht gefunden");
    }

    private async Task ActivateAsync(int carId, IReadOnlyCollection<string> assetIds)
    {
        if (assetIds.Count == 0) return;
        await db.OverlayAssets
            .Where(a => a.CarId == carId && a.Status == OverlayAssetStatus.Pending && assetIds.Contains(a.AssetId))
            .ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, OverlayAssetStatus.Active));
    }

    /// <summary>Asset ids of all svgAsset elements, including variants and disabled parts.</summary>
    public static IReadOnlyCollection<string> AssetIds(JsonNode? doc)
    {
        var ids = new SortedSet<string>(StringComparer.Ordinal);
        void Collect(JsonObject? elements)
        {
            foreach (var (_, element) in elements ?? new JsonObject())
            {
                if (element?["type"]?.GetValue<string>() == "svgAsset" && element["assetId"] is JsonValue v && v.TryGetValue<string>(out var id))
                {
                    ids.Add(id);
                }
            }
        }
        Collect(doc?["elements"] as JsonObject);
        foreach (var (_, variant) in doc?["variants"] as JsonObject ?? new JsonObject())
        {
            Collect(variant?["addedElements"] as JsonObject);
        }
        return ids;
    }

    /// <summary>
    /// Removes assets nothing refers to any more: neither the draft, nor a kept
    /// revision, nor a publication. Pending uploads get 24 h to be referenced.
    /// </summary>
    public async Task CollectGarbageAsync(int carId)
    {
        var referenced = new HashSet<string>(StringComparer.Ordinal);
        var draft = await db.OverlayDrafts.AsNoTracking().Where(d => d.CarId == carId).Select(d => d.DocumentJson).FirstOrDefaultAsync();
        if (draft != null) referenced.UnionWith(AssetIds(JsonNode.Parse(draft)));
        foreach (var json in await db.OverlayDraftRevisions.AsNoTracking().Where(r => r.CarId == carId).Select(r => r.DocumentJson).ToListAsync())
        {
            referenced.UnionWith(AssetIds(JsonNode.Parse(json)));
        }
        referenced.UnionWith(await db.OverlayPublicationAssets.AsNoTracking()
            .Where(pa => pa.Publication.CarId == carId).Select(pa => pa.AssetId).ToListAsync());

        var pendingCutoff = Now - PendingAssetLifetime;
        var candidates = await db.OverlayAssets
            .Where(a => a.CarId == carId && (a.Status == OverlayAssetStatus.Active || a.CreatedAt < pendingCutoff))
            .Select(a => new { a.Id, a.AssetId }).ToListAsync();
        var unused = candidates.Where(a => !referenced.Contains(a.AssetId)).Select(a => a.Id).ToList();
        if (unused.Count > 0) await db.OverlayAssets.Where(a => unused.Contains(a.Id)).ExecuteDeleteAsync();
    }
}
