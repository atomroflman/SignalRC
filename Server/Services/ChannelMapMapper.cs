using System.Text.Json;
using LteCar.Server.Data;
using LteCar.Shared.Channels;
using LteCar.Shared.Video;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Services;

/// <summary>
/// Converts between the domain <see cref="ChannelMap"/> and the EF Core database entities.
/// This is the single place where server-side channel configuration is read from or written to Postgres.
/// </summary>
public static class ChannelMapMapper
{
    public static async Task<ChannelMap> FromDbAsync(int carId, LteCarContext db, CancellationToken cancellationToken = default)
    {
        var controls = await db.CarChannels.AsNoTracking().Where(c => c.CarId == carId).ToListAsync(cancellationToken);
        var telemetries = await db.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId).ToListAsync(cancellationToken);
        var streams = await db.CarVideoStreams.AsNoTracking().Where(v => v.CarId == carId).ToListAsync(cancellationToken);
        var pinManagers = await db.CarPinManagers.AsNoTracking().Where(p => p.CarId == carId).ToListAsync(cancellationToken);

        return new ChannelMap
        {
            PinManagers = pinManagers.ToDictionary(
                p => p.Name,
                p => new PinManagerMapItem
                {
                    Type = p.Type,
                    Options = DeserializeOptions(p.OptionsJson)
                }),
            ControlChannels = controls.ToDictionary(
                c => c.ChannelName,
                c => new ControlChannelMapItem
                {
                    PinManager = c.PinManager,
                    Address = c.Address,
                    ControlType = c.ControlType ?? string.Empty,
                    MaxResendInterval = c.MaxResendInterval,
                    TestDisabled = c.TestDisabled,
                    Options = DeserializeOptions(c.OptionsJson),
                    ServerId = c.Id,
                    ModifiedAt = c.ModifiedAt,
                }),
            TelemetryChannels = telemetries.ToDictionary(
                t => t.ChannelName,
                t => new TelemetryChannelMapItem
                {
                    PinManager = t.PinManager,
                    Address = t.Address,
                    ReadIntervalTicks = t.ReadIntervalTicks,
                    TelemetryType = t.TelemetryType,
                    DataType = t.DataType,
                    Unit = t.Unit,
                    Decimals = t.Decimals,
                    Options = DeserializeOptions(t.OptionsJson),
                    ServerId = t.Id,
                    ModifiedAt = t.ModifiedAt,
                }),
            VideoStreams = streams.ToDictionary(
                s => s.StreamId,
                s => new VideoStreamMapItem
                {
                    StreamId = s.StreamId,
                    Name = s.Name,
                    Type = s.Type,
                    Location = s.Location,
                    Enabled = s.Enabled,
                    Width = s.Width,
                    Height = s.Height,
                    Framerate = s.Framerate,
                    Bitrate = s.Bitrate,
                    Gain = s.Gain,
                    Shutter = s.Shutter,
                    Brightness = s.Brightness,
                    Contrast = s.Contrast,
                    EV = s.EV,
                    Exposure = s.Exposure,
                    CameraDevice = s.CameraDevice,
                    RpiCamId = s.RpiCamId,
                    Options = DeserializeOptions(s.OptionsJson),
                    ServerId = s.Id,
                    ModifiedAt = s.ModifiedAt,
                    Port = s.Port
                })
        };
    }

    /// <summary>
    /// Replaces all channel configuration for a car with the provided <see cref="ChannelMap"/>.
    /// Use this when the server is the source of truth and the client uploads its full config.
    /// </summary>
    public static async Task SaveToDbAsync(int carId, ChannelMap map, LteCarContext db, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;

        // Remove existing config
        db.CarChannels.RemoveRange(await db.CarChannels.Where(c => c.CarId == carId).ToListAsync(cancellationToken));
        db.CarTelemetry.RemoveRange(await db.CarTelemetry.Where(t => t.CarId == carId).ToListAsync(cancellationToken));
        db.CarVideoStreams.RemoveRange(await db.CarVideoStreams.Where(v => v.CarId == carId).ToListAsync(cancellationToken));
        db.CarPinManagers.RemoveRange(await db.CarPinManagers.Where(p => p.CarId == carId).ToListAsync(cancellationToken));

        // Insert PinManagers
        foreach (var kv in map.PinManagers)
        {
            db.CarPinManagers.Add(new CarPinManager
            {
                CarId = carId,
                Name = kv.Key,
                Type = kv.Value.Type ?? string.Empty,
                OptionsJson = SerializeOptions(kv.Value.Options),
                ModifiedAt = now
            });
        }

        // Insert ControlChannels
        foreach (var kv in map.ControlChannels)
        {
            db.CarChannels.Add(new CarChannel
            {
                CarId = carId,
                ChannelName = kv.Key,
                DisplayName = kv.Key,
                IsEnabled = true,
                PinManager = kv.Value.PinManager,
                Address = kv.Value.Address,
                ControlType = kv.Value.ControlType,
                MaxResendInterval = kv.Value.MaxResendInterval,
                TestDisabled = kv.Value.TestDisabled,
                OptionsJson = SerializeOptions(kv.Value.Options),
                ModifiedAt = kv.Value.ModifiedAt ?? now
            });
        }

        // Insert TelemetryChannels
        foreach (var kv in map.TelemetryChannels)
        {
            db.CarTelemetry.Add(new CarTelemetry
            {
                CarId = carId,
                ChannelName = kv.Key,
                PinManager = kv.Value.PinManager,
                Address = kv.Value.Address,
                ReadIntervalTicks = kv.Value.ReadIntervalTicks,
                TelemetryType = kv.Value.TelemetryType,
                DataType = kv.Value.DataType,
                Unit = kv.Value.Unit,
                Decimals = kv.Value.Decimals,
                OptionsJson = SerializeOptions(kv.Value.Options),
                ModifiedAt = kv.Value.ModifiedAt ?? now
            });
        }

        // Insert VideoStreams
        foreach (var kv in map.VideoStreams)
        {
            db.CarVideoStreams.Add(new CarVideoStream
            {
                CarId = carId,
                StreamId = kv.Key,
                Name = kv.Value.Name ?? kv.Key,
                Type = kv.Value.Type ?? "camera",
                Location = kv.Value.Location,
                Enabled = kv.Value.Enabled,
                Width = kv.Value.Width ?? 1280,
                Height = kv.Value.Height ?? 720,
                Framerate = kv.Value.Framerate ?? 30,
                Bitrate = kv.Value.Bitrate ?? 1500,
                Brightness = kv.Value.Brightness ?? 0.5f,
                Gain = kv.Value.Gain,
                Shutter = kv.Value.Shutter,
                Contrast = kv.Value.Contrast,
                EV = kv.Value.EV,
                Exposure = kv.Value.Exposure,
                CameraDevice = kv.Value.CameraDevice,
                RpiCamId = kv.Value.RpiCamId,
                OptionsJson = SerializeOptions(kv.Value.Options),
                ModifiedAt = kv.Value.ModifiedAt ?? now,
                StartTime = now,
                Protocol = StreamProtocol.UDP,
                Port = 0,
                IsActive = kv.Value.Enabled
            });
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    private static Dictionary<string, object> DeserializeOptions(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new(); }
        catch { return new(); }
    }

    private static string? SerializeOptions(Dictionary<string, object>? options)
    {
        if (options == null || options.Count == 0) return null;
        return JsonSerializer.Serialize(options);
    }
}
