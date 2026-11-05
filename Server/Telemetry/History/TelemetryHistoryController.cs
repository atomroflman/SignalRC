using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Server.Telemetry.History;

/// <summary>
/// Telemetry history of a vehicle: recording settings, sessions, samples and the
/// dashboard layout. Readable and editable by every signed-in user, like the
/// live telemetry and the channel configuration.
/// </summary>
[ApiController]
[Route("api/cars/{carId:int}/telemetry-history")]
public class TelemetryHistoryController(
    SignalRCContext context,
    TelemetryRecorder recorder,
    TelemetryRelay relay,
    SignalRC.Server.Overlay.OverlayAccess access,
    ILogger<TelemetryHistoryController> logger) : Controllers.ControllerBase(context)
{
    public const int MinRetentionDays = 1;
    public const int MaxRetentionDays = 365;
    private const int DefaultPoints = 1500;
    private const int MaxLayoutLength = 256 * 1024;

    // --- Settings ---

    [HttpGet("settings")]
    public async Task<IActionResult> GetSettings(int carId)
    {
        if (await GetCurrentUserAsync() == null) return Unauthorized();
        var car = await _context.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound();
        var channels = await _context.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId).OrderBy(t => t.ChannelName).ToListAsync();
        return Ok(new
        {
            retentionDays = car.TelemetryRetentionDays,
            recordingStopped = car.TelemetryRecordingStopped,
            channels = channels.Select(t => new
            {
                id = t.Id,
                name = t.ChannelName,
                dataType = t.DataType.ToString(),
                unit = t.Unit,
                decimals = t.Decimals,
                record = t.Record,
                recordable = TelemetryRecorder.IsRecordable(t.DataType),
            }),
        });
    }

    public sealed class SettingsDto
    {
        public int RetentionDays { get; set; }
        public int[] Recorded { get; set; } = [];
    }

    [HttpPut("settings")]
    public async Task<IActionResult> PutSettings(int carId, [FromBody] SettingsDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound();
        if (body.RetentionDays < MinRetentionDays || body.RetentionDays > MaxRetentionDays)
        {
            return BadRequest($"retentionDays must be between {MinRetentionDays} and {MaxRetentionDays}");
        }
        car.TelemetryRetentionDays = body.RetentionDays;
        var recorded = body.Recorded.ToHashSet();
        var channels = await _context.CarTelemetry.Where(t => t.CarId == carId).ToListAsync();
        foreach (var t in channels) t.Record = recorded.Contains(t.Id) && TelemetryRecorder.IsRecordable(t.DataType);
        await _context.SaveChangesAsync();

        var ids = await recorder.RefreshAsync(carId);
        await relay.SetRecordedAsync(carId, ids);
        logger.LogInformation("Telemetry history settings of car {CarId} by {User}: {Count} channels, {Days} days",
            carId, user.LoginName, ids.Count, car.TelemetryRetentionDays);
        return await GetSettings(carId);
    }

    // --- Master switch (main page) ---

    /// <summary>Whether recording is stopped, how many channels are selected and whether the caller may switch it.</summary>
    [HttpGet("recording")]
    public async Task<IActionResult> GetRecording(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound();
        var channels = await _context.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId && t.Record).Select(t => t.DataType).ToListAsync();
        var active = await _context.TelemetrySessions.AsNoTracking().AnyAsync(s => s.CarId == carId && s.EndedAt == null);
        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            stopped = car.TelemetryRecordingStopped,
            channels = channels.Count(TelemetryRecorder.IsRecordable),
            recording = active,
            canChange = access.CheckAdmin(user, carId) == SignalRC.Server.Overlay.OverlayAccessError.None,
        });
    }

    public sealed class RecordingDto
    {
        public bool Stopped { get; set; }
    }

    /// <summary>Stops or resumes all recording of the vehicle; only the driver who holds control.</summary>
    [HttpPut("recording")]
    public async Task<IActionResult> PutRecording(int carId, [FromBody] RecordingDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (access.CheckAdmin(user, carId) != SignalRC.Server.Overlay.OverlayAccessError.None)
        {
            return StatusCode(StatusCodes.Status403Forbidden, "Only the driver who controls the vehicle can change this.");
        }
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound();
        if (car.TelemetryRecordingStopped != body.Stopped)
        {
            car.TelemetryRecordingStopped = body.Stopped;
            await _context.SaveChangesAsync();
            var ids = await recorder.RefreshAsync(carId);
            await relay.SetRecordedAsync(carId, ids);
            logger.LogInformation("Telemetry recording of car {CarId} {State} by driver {User}",
                carId, body.Stopped ? "stopped" : "resumed", user.LoginName ?? user.Name);
        }
        return await GetRecording(carId);
    }

    // --- Sessions ---

    [HttpGet("sessions")]
    public async Task<IActionResult> GetSessions(int carId)
    {
        if (await GetCurrentUserAsync() == null) return Unauthorized();
        var sessions = await _context.TelemetrySessions.AsNoTracking()
            .Where(s => s.CarId == carId)
            .OrderByDescending(s => s.StartedAt)
            .Take(500)
            .Select(s => new { s.Id, s.StartedAt, s.EndedAt, s.LastSampleAt })
            .ToListAsync();
        return Ok(sessions.Select(s => new
        {
            id = s.Id,
            startedAt = Ms(s.StartedAt),
            endedAt = s.EndedAt == null ? (long?)null : Ms(s.EndedAt.Value),
            lastSampleAt = s.LastSampleAt == null ? (long?)null : Ms(s.LastSampleAt.Value),
            active = s.EndedAt == null,
        }));
    }

    [HttpGet("sessions/{sessionId:int}")]
    public async Task<IActionResult> GetSession(int carId, int sessionId)
    {
        if (await GetCurrentUserAsync() == null) return Unauthorized();
        var s = await _context.TelemetrySessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sessionId && x.CarId == carId);
        if (s == null) return NotFound();
        return Ok(new
        {
            id = s.Id,
            startedAt = Ms(s.StartedAt),
            endedAt = s.EndedAt == null ? (long?)null : Ms(s.EndedAt.Value),
            lastSampleAt = s.LastSampleAt == null ? (long?)null : Ms(s.LastSampleAt.Value),
            active = s.EndedAt == null,
            channels = TelemetryRecorder.ReadChannels(s.ChannelsJson).Select(c => new
            {
                id = c.Id,
                name = c.Name,
                dataType = c.DataType.ToString(),
                unit = c.Unit,
                decimals = c.Decimals,
            }),
        });
    }

    [HttpDelete("sessions/{sessionId:int}")]
    public async Task<IActionResult> DeleteSession(int carId, int sessionId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var deleted = await _context.TelemetrySessions.Where(s => s.Id == sessionId && s.CarId == carId && s.EndedAt != null).ExecuteDeleteAsync();
        if (deleted == 0) return NotFound();
        logger.LogInformation("Telemetry session {SessionId} of car {CarId} deleted by {User}", sessionId, carId, user.LoginName);
        return NoContent();
    }

    /// <summary>
    /// Samples of a session between <paramref name="from"/> and <paramref name="to"/>
    /// (Unix ms). With <paramref name="after"/> only raw samples newer than it
    /// (live follow). Otherwise raw while that fits <paramref name="points"/> per
    /// channel, else min and max per time bucket.
    /// </summary>
    [HttpGet("sessions/{sessionId:int}/samples")]
    public async Task<IActionResult> GetSamples(int carId, int sessionId, long? from, long? to, long? after, int? points)
    {
        if (await GetCurrentUserAsync() == null) return Unauthorized();
        var s = await _context.TelemetrySessions.AsNoTracking().FirstOrDefaultAsync(x => x.Id == sessionId && x.CarId == carId);
        if (s == null) return NotFound();

        var start = from ?? Ms(s.StartedAt);
        var end = to ?? Ms(s.LastSampleAt ?? s.EndedAt ?? DateTime.UtcNow);
        if (end <= start) end = start + 1;
        var buckets = Math.Clamp(points ?? DefaultPoints, 50, 5000);
        Response.Headers.CacheControl = "no-store";

        var result = await TelemetryHistoryReader.ReadSamplesAsync(_context, sessionId, start, end, after, buckets);
        return Ok(new
        {
            from = start,
            to = end,
            resolutionMs = result.ResolutionMs,
            channels = result.Channels.ToDictionary(kv => kv.Key.ToString(), kv => new { t = kv.Value.T, v = kv.Value.V }),
        });
    }

    // --- Dashboard layout ---

    [HttpGet("dashboard")]
    public async Task<IActionResult> GetDashboard(int carId)
    {
        if (await GetCurrentUserAsync() == null) return Unauthorized();
        var d = await _context.CarTelemetryDashboards.AsNoTracking().FirstOrDefaultAsync(x => x.CarId == carId);
        if (d == null) return Ok(new { layout = (object?)null });
        using var doc = JsonDocument.Parse(d.LayoutJson);
        return Ok(new { layout = doc.RootElement.Clone(), modifiedAt = Ms(d.ModifiedAt) });
    }

    [HttpPut("dashboard")]
    public async Task<IActionResult> PutDashboard(int carId, [FromBody] JsonElement layout)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound();
        if (layout.ValueKind != JsonValueKind.Object) return BadRequest("layout must be an object");
        var json = layout.GetRawText();
        if (json.Length > MaxLayoutLength) return BadRequest("layout too large");
        var d = await _context.CarTelemetryDashboards.FirstOrDefaultAsync(x => x.CarId == carId);
        if (d == null)
        {
            d = new CarTelemetryDashboard { CarId = carId };
            _context.CarTelemetryDashboards.Add(d);
        }
        d.LayoutJson = json;
        d.ModifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        return Ok(new { modifiedAt = Ms(d.ModifiedAt) });
    }

    private static long Ms(DateTime utc) => TelemetryHistoryReader.Ms(utc);
}
