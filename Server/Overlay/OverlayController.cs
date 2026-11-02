using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using SignalRC.Server.Data;

namespace SignalRC.Server.Overlay;

/// <summary>Overlay REST API (Shared/Overlay/api/README.md §3).</summary>
[ApiController]
[Route("api/cars/{carId:int}/overlay")]
public class OverlayController(SignalRCContext context, OverlayService overlay) : Controllers.ControllerBase(context)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public sealed record PublishRequest(long BaseRevision, string? Note);
    public sealed record RestoreRequest(int PublicationId, long BaseRevision);

    [HttpGet("published")]
    public async Task<IActionResult> GetPublished(int carId)
    {
        var result = await overlay.GetPublishedAsync(carId);
        if (result.Error != null) return Problem(result.Error);
        if (result.Value == null) return NoContent();
        return Ok(new { result.Value.PublicationId, result.Value.Number, result.Value.PublishedAt, document = result.Value.Document });
    }

    [HttpGet("assets/{assetId}")]
    public async Task<IActionResult> GetAsset(int carId, string assetId)
    {
        var result = await overlay.GetAssetAsync(carId, assetId, await GetCurrentUserAsync());
        if (result.Error != null) return Problem(result.Error);
        // Assets are immutable and content-addressed; the CSP keeps a directly
        // opened SVG inert even though it is already sanitized.
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'";
        Response.Headers.XContentTypeOptions = "nosniff";
        return Content(result.Value!, "image/svg+xml");
    }

    [HttpGet("draft")]
    public async Task<IActionResult> GetDraft(int carId)
    {
        var result = await overlay.GetDraftAsync(carId, await GetCurrentUserAsync());
        if (result.Error != null) return Problem(result.Error);
        var draft = result.Value!;
        Response.Headers.ETag = $"\"{draft.Revision}\"";
        return Ok(new { draft.Revision, document = draft.Document, draft.UpdatedAt, draft.UpdatedBy });
    }

    [HttpPut("draft")]
    public Task<IActionResult> PutDraft(int carId) =>
        WriteDraft(carId, (user, body, revision) => overlay.SaveDraftAsync(carId, user, body, revision));

    [HttpPatch("draft")]
    public Task<IActionResult> PatchDraft(int carId) =>
        WriteDraft(carId, (user, body, revision) => overlay.PatchDraftAsync(carId, user, body, revision));

    private async Task<IActionResult> WriteDraft(int carId, Func<User?, byte[], long, Task<OverlayResult<SavedDraft>>> write)
    {
        if (!TryGetIfMatch(out var revision))
        {
            return Problem(new OverlayError("OVL_API_PRECONDITION_REQUIRED", 428, "If-Match mit der Basisrevision fehlt"));
        }
        var body = await ReadBodyAsync(OverlayService.MaxDocumentBytes);
        if (body == null) return Problem(new OverlayError("OVL_API_TOO_LARGE", 413, "Dokument größer als 2 MB"));
        var result = await write(await GetCurrentUserAsync(), body, revision);
        if (result.Error != null) return Problem(result.Error);
        Response.Headers.ETag = $"\"{result.Value!.Revision}\"";
        return Ok(new { result.Value.Revision });
    }

    [HttpGet("publications")]
    public async Task<IActionResult> ListPublications(int carId)
    {
        var result = await overlay.ListPublicationsAsync(carId, await GetCurrentUserAsync());
        return result.Error != null ? Problem(result.Error) : Ok(result.Value);
    }

    [HttpGet("publications/{publicationId:int}")]
    public async Task<IActionResult> GetPublication(int carId, int publicationId)
    {
        var result = await overlay.GetPublicationAsync(carId, publicationId, await GetCurrentUserAsync());
        if (result.Error != null) return Problem(result.Error);
        var p = result.Value!;
        return Ok(new { p.PublicationId, p.Number, p.PublishedAt, document = p.Document });
    }

    [HttpPost("publications")]
    public async Task<IActionResult> Publish(int carId, [FromBody] PublishRequest request)
    {
        var result = await overlay.PublishAsync(carId, await GetCurrentUserAsync(), request.BaseRevision, request.Note);
        if (result.Error != null) return Problem(result.Error);
        var json = JsonSerializer.SerializeToNode(result.Value, Json);
        return StatusCode(201, json);
    }

    [HttpPost("draft/restore")]
    public async Task<IActionResult> Restore(int carId, [FromBody] RestoreRequest request)
    {
        var result = await overlay.RestoreAsync(carId, await GetCurrentUserAsync(), request.PublicationId, request.BaseRevision);
        if (result.Error != null) return Problem(result.Error);
        Response.Headers.ETag = $"\"{result.Value!.Revision}\"";
        return Ok(new { result.Value.Revision });
    }

    [HttpPost("assets")]
    [RequestSizeLimit(OverlayService.MaxAssetBytes + 64 * 1024)]
    public async Task<IActionResult> UploadAsset(int carId, IFormFile? file)
    {
        if (file == null) return Problem(new OverlayError("OVL_API_INVALID_REQUEST", 400, "Datei fehlt"));
        if (file.Length > OverlayService.MaxAssetBytes) return Problem(new OverlayError("OVL_API_TOO_LARGE", 413, "SVG größer als 256 kB"));
        using var buffer = new MemoryStream();
        await file.CopyToAsync(buffer);
        var result = await overlay.UploadAssetAsync(carId, await GetCurrentUserAsync(), buffer.ToArray());
        if (result.Error != null) return Problem(result.Error);
        var upload = result.Value!;
        return Ok(new { upload.AssetId, metadata = upload.Metadata, svg = upload.Svg, report = upload.Report });
    }

    private bool TryGetIfMatch(out long revision)
    {
        revision = 0;
        var value = Request.Headers.IfMatch.ToString().Trim();
        return value.Length >= 3 && value[0] == '"' && value[^1] == '"' && long.TryParse(value[1..^1], out revision) && revision >= 0;
    }

    /// <summary>Reads the (already decompressed) body; null when it exceeds <paramref name="limit"/>.</summary>
    private async Task<byte[]?> ReadBodyAsync(int limit)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await Request.Body.ReadAsync(chunk)) > 0)
        {
            if (buffer.Length + read > limit) return null;
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }

    private ObjectResult Problem(OverlayError error)
    {
        var body = new JsonObject
        {
            ["type"] = "about:blank",
            ["title"] = error.Title,
            ["status"] = error.Status,
            ["code"] = error.Code,
        };
        if (error.Diagnostics != null) body["diagnostics"] = JsonSerializer.SerializeToNode(error.Diagnostics, Json);
        if (error.CurrentRevision != null) body["currentRevision"] = error.CurrentRevision;
        if (error.Report != null) body["report"] = error.Report.DeepClone();
        var result = new ObjectResult(body) { StatusCode = error.Status };
        result.ContentTypes.Add("application/problem+json");
        return result;
    }
}
