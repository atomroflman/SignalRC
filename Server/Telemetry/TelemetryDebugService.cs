using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Shared.Channels;

namespace SignalRC.Server.Telemetry;

/// <summary>Short info of a LidarGrid sample value (Shared/Overlay/lidar/README.md §4, §5); never the grid itself.</summary>
public sealed record LidarGridSummary(int Length, bool? Complete, string? Encoding, int Occupied, string? Error);

public sealed record TelemetryDebugChannel(
    int Id,
    string? Name,
    string? DataType,
    string? Value,
    int? ValueLength,
    string? State,
    int? AgeMs,
    long? ReceivedAgoMs,
    bool InDemand,
    int Interested,
    long Changes,
    long Touches,
    LidarGridSummary? Lidar);

public sealed record TelemetryDebugState(
    int CarId,
    bool OnboardConnected,
    string? Epoch,
    long? Seq,
    long? LastMessageAgoMs,
    long AcceptedDeltas,
    long DroppedOldSeq,
    int[] Demand,
    long? DemandSentAgoMs,
    int InterestedConnections,
    int LegacyClients,
    IReadOnlyList<TelemetryDebugChannel> Channels);

/// <summary>
/// GET telemetry-debug (Shared/Overlay/api/README.md §3): the relay's view of a
/// vehicle for the overlay administrator (D73), so server and client can be
/// told apart when values do not arrive.
/// </summary>
public sealed partial class TelemetryDebugService(SignalRCContext db, OverlayAccess access, TelemetryRelay relay)
{
    public const int MaxValueChars = 64;
    public const int LidarFields = 96 * 5;

    public async Task<OverlayResult<TelemetryDebugState>> GetAsync(int carId, User? user)
    {
        if (!await db.Cars.AnyAsync(c => c.Id == carId)) return new OverlayError("OVL_API_NOT_FOUND", 404, "Fahrzeug nicht gefunden");
        var denied = await access.CheckAdminAsync(user, carId);
        if (denied == OverlayAccessError.SessionRequired) return new OverlayError("OVL_API_SESSION_REQUIRED", 401, "Sitzung fehlt");
        if (denied != OverlayAccessError.None) return new OverlayError("OVL_API_NOT_DRIVER", 403, "Nur wer die Steuerung des Fahrzeugs hält, darf die Telemetrie-Diagnose sehen");

        var defined = await db.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId)
            .Select(t => new { t.Id, t.ChannelName, t.DataType }).ToListAsync();
        var snapshot = relay.Snapshot(carId);
        var cached = snapshot.Channels.ToDictionary(c => c.Id);
        var ids = defined.Select(d => d.Id).Concat(cached.Keys).Distinct().Order();
        var byId = defined.ToDictionary(d => d.Id);
        var channels = ids.Select(id =>
        {
            byId.TryGetValue(id, out var d);
            cached.TryGetValue(id, out var c);
            var lidar = d?.DataType == TelemetryDataType.LidarGrid && c?.Value != null ? SummarizeLidarGrid(c.Value) : null;
            return new TelemetryDebugChannel(
                id,
                d?.ChannelName ?? c?.Name,
                d?.DataType.ToString(),
                c?.Value == null ? null : Truncate(c.Value),
                c?.Value?.Length,
                c?.State?.ToString(),
                c?.AgeMs,
                c?.ReceivedAgoMs,
                c?.InDemand ?? false,
                c?.Interested ?? 0,
                c?.Changes ?? 0,
                c?.Touches ?? 0,
                lidar);
        }).ToList();

        return new TelemetryDebugState(
            carId,
            snapshot.OnboardConnected,
            snapshot.Epoch,
            snapshot.Seq < 0 ? null : snapshot.Seq,
            snapshot.LastMessageAgoMs,
            snapshot.AcceptedDeltas,
            snapshot.DroppedOldSeq,
            snapshot.Demand,
            snapshot.DemandSentAgoMs,
            snapshot.InterestedConnections,
            snapshot.LegacyClients,
            channels);
    }

    public static string Truncate(string value) => value.Length <= MaxValueChars ? value : value[..MaxValueChars] + "…";

    [GeneratedRegex("^1([01])([ds]):([A-Za-z0-9+/]*={0,2})$")]
    private static partial Regex LidarValue();

    /// <summary>Same rules as the client decoder (Client/.../sources/lidar-grid.ts); the error names the first broken rule.</summary>
    public static LidarGridSummary SummarizeLidarGrid(string value)
    {
        var m = LidarValue().Match(value);
        if (!m.Success) return new LidarGridSummary(value.Length, null, null, 0, "format");
        var complete = m.Groups[1].Value == "1";
        var encoding = m.Groups[2].Value == "d" ? "dense" : "sparse";
        byte[] bytes;
        try
        {
            if (m.Groups[3].Value.Length % 4 != 0) throw new FormatException();
            bytes = Convert.FromBase64String(m.Groups[3].Value);
        }
        catch (FormatException)
        {
            return new LidarGridSummary(value.Length, complete, encoding, 0, "base64");
        }
        int U16(int i) => bytes[i] | (bytes[i + 1] << 8);
        var occupied = 0;
        if (encoding == "dense")
        {
            if (bytes.Length != LidarFields * 2) return new LidarGridSummary(value.Length, complete, encoding, 0, "length");
            for (var i = 0; i < LidarFields; i++) if (U16(i * 2) != 0xFFFF) occupied++;
        }
        else
        {
            if (bytes.Length % 4 != 0) return new LidarGridSummary(value.Length, complete, encoding, 0, "length");
            var prev = -1;
            for (var i = 0; i < bytes.Length; i += 4)
            {
                var index = U16(i);
                if (index >= LidarFields || index <= prev) return new LidarGridSummary(value.Length, complete, encoding, 0, "index");
                if (U16(i + 2) != 0xFFFF) occupied++;
                prev = index;
            }
        }
        return new LidarGridSummary(value.Length, complete, encoding, occupied, null);
    }
}
