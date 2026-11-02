using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Channels;

namespace SignalRC.Server.Overlay.Lidar;

public sealed record LidarGridSourceResult(bool Created, CarTelemetry Channel);

/// <summary>
/// "LiDAR-HUD-Quelle einrichten" (Shared/Overlay/lidar/README.md §7, D17):
/// adds the grid channel through the regular channel tables, only for the
/// overlay administrator. An existing channel is left untouched. Showing or
/// publishing an HUD never calls this.
/// </summary>
public sealed class LidarGridSourceService(SignalRCContext db, OverlayAccess access)
{
    public const string ChannelName = "lidarGrid";
    /// <summary>Type name as the onboard resolves it (Type.GetType in its own assembly).</summary>
    public const string ReaderType = "SignalRC.Onboard.Telemetry.LidarGridTelemetryReader";
    public const int ReadIntervalTicks = 2;
    public const string DefaultPinManager = "lidar";
    private const string LidarManagerType = "LidarManager";

    /// <summary>Channel options of §1 with their defaults.</summary>
    public static Dictionary<string, object> DefaultOptions(string pinManager) => new()
    {
        ["groupKey"] = ChannelName,
        ["pinManager"] = pinManager,
        ["mountYawDeg"] = 0,
        ["zoneLimitsMm"] = new[] { 500, 1000, 2000, 3000, 5000 },
        ["neighborMaxMm"] = 50,
        ["minGroupPoints"] = 3,
    };

    public async Task<OverlayResult<LidarGridSourceResult>> EnsureAsync(int carId, User? user)
    {
        if (!await db.Cars.AnyAsync(c => c.Id == carId)) return new OverlayError("OVL_API_NOT_FOUND", 404, "Fahrzeug nicht gefunden");
        var denied = await access.CheckAdminAsync(user, carId);
        if (denied != OverlayAccessError.None) return AccessError(denied);

        var existing = await Find(carId);
        if (existing != null) return new LidarGridSourceResult(false, existing);

        var pinManager = await PinManagerAsync(carId);
        var channel = new CarTelemetry
        {
            CarId = carId,
            ChannelName = ChannelName,
            TelemetryType = ReaderType,
            DataType = TelemetryDataType.LidarGrid,
            ReadIntervalTicks = ReadIntervalTicks,
            PinManager = pinManager,
            OptionsJson = JsonSerializer.Serialize(DefaultOptions(pinManager)),
            ModifiedAt = DateTime.UtcNow,
        };
        db.CarTelemetry.Add(channel);
        try
        {
            await db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            // A concurrent request created it first (unique CarId + ChannelName).
            db.Entry(channel).State = EntityState.Detached;
            var winner = await Find(carId);
            if (winner == null) throw;
            return new LidarGridSourceResult(false, winner);
        }

        var car = await db.Cars.FirstAsync(c => c.Id == carId);
        car.ChannelMapHash = ChannelMapHashProvider.GenerateHash(await ChannelMapMapper.FromDbAsync(carId, db));
        await db.SaveChangesAsync();
        return new LidarGridSourceResult(true, channel);
    }

    private Task<CarTelemetry?> Find(int carId) =>
        db.CarTelemetry.AsNoTracking().FirstOrDefaultAsync(t => t.CarId == carId && t.ChannelName == ChannelName);

    /// <summary>The vehicle's LiDAR pin manager: "lidar" if present, else the only LidarManager, else the default name.</summary>
    private async Task<string> PinManagerAsync(int carId)
    {
        var lidars = await db.CarPinManagers.AsNoTracking()
            .Where(p => p.CarId == carId && p.Type == LidarManagerType)
            .Select(p => p.Name).ToListAsync();
        if (lidars.Contains(DefaultPinManager) || lidars.Count != 1) return DefaultPinManager;
        return lidars[0];
    }

    private static OverlayError AccessError(OverlayAccessError error) => error switch
    {
        OverlayAccessError.LoginRequired => new("OVL_API_LOGIN_REQUIRED", 401, "Anmeldung erforderlich"),
        OverlayAccessError.NoCarAccess => new("OVL_API_NO_CAR_ACCESS", 403, "Kein Zugang zu diesem Fahrzeug"),
        _ => new("OVL_API_NOT_DRIVER", 403, "Nur der aktive Fahrer darf das Overlay verwalten"),
    };

    /// <summary>The channel as the onboard needs it, including its server id.</summary>
    public static TelemetryChannelMapItem ToMapItem(CarTelemetry t) => new()
    {
        PinManager = t.PinManager,
        Address = t.Address,
        ReadIntervalTicks = t.ReadIntervalTicks,
        TelemetryType = t.TelemetryType,
        DataType = t.DataType,
        Unit = t.Unit,
        Decimals = t.Decimals,
        Options = string.IsNullOrEmpty(t.OptionsJson)
            ? new()
            : JsonSerializer.Deserialize<Dictionary<string, object>>(t.OptionsJson) ?? new(),
        ServerId = t.Id,
        ModifiedAt = t.ModifiedAt,
    };
}
