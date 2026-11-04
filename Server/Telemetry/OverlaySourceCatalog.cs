using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;

namespace SignalRC.Server.Telemetry;

/// <summary>Telemetry channel metadata a live HUD needs (telemetry contract §6).</summary>
public sealed record TelemetrySourceInfo(int Id, string ChannelName, string DataType, string? Unit, byte? Decimals, int ReadIntervalTicks, int[]? ZoneLimitsMm);

/// <summary>A computed vehicle channel output: CarChannel.Id ↔ name for out() (D69).</summary>
public sealed record OutputSourceInfo(int Id, string ChannelName);

public sealed record OverlaySources(IReadOnlyList<TelemetrySourceInfo> Telemetry, IReadOnlyList<OutputSourceInfo> Outputs);

/// <summary>
/// Read-only source catalog of a vehicle for viewers (D69, D70): same check as
/// watching its streams, no login or UserSetup, no personal fields.
/// </summary>
public static class OverlaySourceCatalog
{
    public static async Task<OverlaySources?> LoadAsync(SignalRCContext db, OverlayAccess access, int carId)
    {
        if (!await access.CanViewCarAsync(carId)) return null;
        var telemetry = await db.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId).OrderBy(t => t.Id).ToListAsync();
        var outputs = await db.CarChannels.AsNoTracking().Where(c => c.CarId == carId).OrderBy(c => c.Id)
            .Select(c => new OutputSourceInfo(c.Id, c.ChannelName)).ToListAsync();
        return new OverlaySources(
            telemetry.Select(t => new TelemetrySourceInfo(t.Id, t.ChannelName, DataTypeName(t), t.Unit, t.Decimals, t.ReadIntervalTicks, ZoneLimits(t.OptionsJson))).ToList(),
            outputs);
    }

    /// <summary>Same spelling as GET /api/car/{id}/telemetry: the enum name in lower case.</summary>
    public static string DataTypeName(CarTelemetry t) => t.DataType.ToString().ToLowerInvariant();

    /// <summary>
    /// LiDAR zone limits from the channel options (LiDAR contract §1), as a JSON
    /// array or a comma-separated text; null unless exactly five positive numbers.
    /// </summary>
    public static int[]? ZoneLimits(string? optionsJson)
    {
        if (string.IsNullOrEmpty(optionsJson)) return null;
        try
        {
            using var doc = JsonDocument.Parse(optionsJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !doc.RootElement.TryGetProperty("zoneLimitsMm", out var v)) return null;
            var parts = v.ValueKind switch
            {
                JsonValueKind.Array => v.EnumerateArray().Select(e => e.ToString()).ToArray(),
                JsonValueKind.String => v.GetString()!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries),
                _ => [],
            };
            var limits = parts.Select(p => int.TryParse(p, out var n) ? n : -1).ToArray();
            return limits.Length == 5 && limits.All(n => n > 0) ? limits : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

[ApiController]
[Route("api/cars/{carId:int}/overlay")]
public class OverlaySourcesController(SignalRCContext context, OverlayAccess access) : Controllers.ControllerBase(context)
{
    [HttpGet("sources")]
    public async Task<IActionResult> GetSources(int carId)
    {
        var sources = await OverlaySourceCatalog.LoadAsync(_context, access, carId);
        return sources == null ? NotFound("Fahrzeug nicht gefunden") : Ok(sources);
    }
}
