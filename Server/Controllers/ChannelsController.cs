using System.Text.Json;
using LteCar.Server.Data;
using LteCar.Server.Hubs;
using LteCar.Server.Services;
using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.HubClients;
using LteCar.Shared.Video;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Controllers;

// ponytail: edit per-channel config from the web UI; mutations push live to the
// connected Onboard via the control hub. Schema already roundtrips every MapItem field
// (PinManager, Address, ControlType, Options, TestDisabled added in 20260720000001).
[ApiController]
[Route("api/cars/{carId:int}/channels")]
public class ChannelsController : ControllerBase
{
    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _controlHub;
    private readonly AvailableTypesRegistry _availableTypes;
    private readonly ILogger<ChannelsController> _logger;

    public ChannelsController(LteCarContext context, IHubContext<CarConnectionHub, IConnectionHubClient> controlHub, AvailableTypesRegistry availableTypes, ILogger<ChannelsController> logger) : base(context)
    {
        _controlHub = controlHub;
        _availableTypes = availableTypes;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var controls = await _context.CarChannels.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();
        var telemetries = await _context.CarTelemetry.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();
        var streams = await _context.CarVideoStreams.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();
        var pinManagers = await _context.CarPinManagers.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();

        var map = new ChannelMap
        {
            PinManagers = pinManagers.ToDictionary(
                p => p.Name,
                p => new PinManagerMapItem
                {
                    Type = p.Type,
                    Options = DeserializeOptions(p.OptionsJson),
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
                    CameraDevice = s.CameraDevice,
                    RpiCamId = s.RpiCamId,
                    Options = DeserializeOptions(s.OptionsJson),
                    ModifiedAt = s.ModifiedAt,
                }),
        };
        return Ok(map);
    }

    [HttpPut("control/{name}")]
    public async Task<IActionResult> UpsertControl(int carId, string name, [FromBody] ControlChannelDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var channelName = string.IsNullOrEmpty(body.ChannelName) ? name : body.ChannelName;
        var ch = await _context.CarChannels.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == channelName);
        if (ch == null)
        {
            ch = new CarChannel { CarId = carId, ChannelName = channelName };
            _context.CarChannels.Add(ch);
            if (channelName != name)
            {
                var old = await _context.CarChannels.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == name);
                if (old != null) _context.CarChannels.Remove(old);
            }
        }
        if (body.DisplayName != null) ch.DisplayName = body.DisplayName;
        ch.IsEnabled = body.IsEnabled;
        ch.RequiresAxis = body.RequiresAxis;
        ch.MaxResendInterval = body.MaxResendInterval;
        if (body.ControlType != null) ch.ControlType = body.ControlType;
        if (body.PinManager != null) ch.PinManager = body.PinManager;
        ch.Address = body.Address;
        ch.OptionsJson = SerializeOptions(body.Options);
        if (body.TestDisabled.HasValue) ch.TestDisabled = body.TestDisabled.Value;
        ch.ModifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        var mapItem = ToMapItem(ch);
        await _controlHub.Clients.Group($"Car-{carId}").UpsertControlChannel(ch.ChannelName, mapItem);
        _logger.LogInformation("Upsert control channel {Channel} for car {CarId} by {User}", ch.ChannelName, carId, user.LoginName);
        return Ok(mapItem);
    }

    [HttpDelete("control/{name}")]
    public async Task<IActionResult> DeleteControl(int carId, string name)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var ch = await _context.CarChannels.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == name);
        if (ch == null) return NotFound();
        _context.Set<UserSetupCarChannelNode>().Where(n => n.CarChannelId == ch.Id).ToList()
            .ForEach(n => _context.Set<UserSetupCarChannelNode>().Remove(n));
        _context.CarChannels.Remove(ch);
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        await _controlHub.Clients.Group($"Car-{carId}").DeleteControlChannel(name);
        _logger.LogInformation("Delete control channel {Channel} for car {CarId} by {User}", name, carId, user.LoginName);
        return NoContent();
    }

    [HttpGet("pinmanager")]
    public async Task<IActionResult> GetPinManagers(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var items = await _context.CarPinManagers
            .AsNoTracking()
            .Where(p => p.CarId == carId)
            .ToListAsync();

        return Ok(items.ToDictionary(
            p => p.Name,
            p => new PinManagerMapItem
            {
                Type = p.Type,
                Options = DeserializeOptions(p.OptionsJson),
            }));
    }

    [HttpPut("pinmanager/{name}")]
    public async Task<IActionResult> UpsertPinManager(int carId, string name, [FromBody] PinManagerDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var managerName = string.IsNullOrEmpty(body.Name) ? name : body.Name;
        var pm = await _context.CarPinManagers.FirstOrDefaultAsync(p => p.CarId == carId && p.Name == managerName);
        if (pm == null)
        {
            pm = new CarPinManager { CarId = carId, Name = managerName };
            _context.CarPinManagers.Add(pm);
            if (managerName != name)
            {
                var old = await _context.CarPinManagers.FirstOrDefaultAsync(p => p.CarId == carId && p.Name == name);
                if (old != null) _context.CarPinManagers.Remove(old);
            }
        }
        pm.Type = body.Type ?? string.Empty;
        pm.OptionsJson = SerializeOptions(body.Options);
        pm.ModifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);
        await PushFullChannelMapAsync(carId);

        var mapItem = new PinManagerMapItem { Type = pm.Type, Options = DeserializeOptions(pm.OptionsJson) };
        _logger.LogInformation("Upsert pin manager {Name} for car {CarId} by {User}", pm.Name, carId, user.LoginName);
        return Ok(mapItem);
    }

    [HttpDelete("pinmanager/{name}")]
    public async Task<IActionResult> DeletePinManager(int carId, string name)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var pm = await _context.CarPinManagers.FirstOrDefaultAsync(p => p.CarId == carId && p.Name == name);
        if (pm == null) return NotFound();
        _context.CarPinManagers.Remove(pm);
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);
        await PushFullChannelMapAsync(carId);

        _logger.LogInformation("Delete pin manager {Name} for car {CarId} by {User}", name, carId, user.LoginName);
        return NoContent();
    }

    [HttpPut("telemetry/{name}")]
    public async Task<IActionResult> UpsertTelemetry(int carId, string name, [FromBody] TelemetryChannelDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var channelName = string.IsNullOrEmpty(body.ChannelName) ? name : body.ChannelName;
        var t = await _context.CarTelemetry.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == channelName);
        if (t == null)
        {
            t = new CarTelemetry { CarId = carId, ChannelName = channelName };
            _context.CarTelemetry.Add(t);
            if (channelName != name)
            {
                var old = await _context.CarTelemetry.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == name);
                if (old != null) _context.CarTelemetry.Remove(old);
            }
        }
        t.ReadIntervalTicks = body.ReadIntervalTicks;
        t.TelemetryType = body.TelemetryType ?? string.Empty;
        t.DataType = body.DataType;
        t.Unit = body.Unit;
        t.Decimals = body.Decimals;
        if (body.PinManager != null) t.PinManager = body.PinManager;
        t.Address = body.Address;
        t.OptionsJson = SerializeOptions(body.Options);
        t.ModifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        var mapItem = ToMapItem(t);
        await _controlHub.Clients.Group($"Car-{carId}").UpsertTelemetryChannel(t.ChannelName, mapItem);
        _logger.LogInformation("Upsert telemetry channel {Channel} for car {CarId} by {User}", t.ChannelName, carId, user.LoginName);
        return Ok(mapItem);
    }

    [HttpDelete("telemetry/{name}")]
    public async Task<IActionResult> DeleteTelemetry(int carId, string name)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var t = await _context.CarTelemetry.FirstOrDefaultAsync(c => c.CarId == carId && c.ChannelName == name);
        if (t == null) return NotFound();
        _context.CarTelemetry.Remove(t);
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        await _controlHub.Clients.Group($"Car-{carId}").DeleteTelemetryChannel(name);
        _logger.LogInformation("Delete telemetry channel {Channel} for car {CarId} by {User}", name, carId, user.LoginName);
        return NoContent();
    }

    [HttpPut("video/{streamId}")]
    public async Task<IActionResult> UpsertVideo(int carId, string streamId, [FromBody] VideoStreamDto body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var sid = string.IsNullOrEmpty(body.StreamId) ? streamId : body.StreamId;
        var s = await _context.CarVideoStreams.FirstOrDefaultAsync(v => v.CarId == carId && v.StreamId == sid);
        if (s == null)
        {
            s = new CarVideoStream
            {
                CarId = carId,
                StreamId = sid,
                Name = body.Name ?? sid,
                Type = body.Type ?? "unknown",
                StartTime = DateTime.UtcNow,
                Protocol = body.Protocol ?? StreamProtocol.TCP,
                Port = body.Port ?? 0,
                Enabled = body.Enabled,
            };
            _context.CarVideoStreams.Add(s);
            if (sid != streamId)
            {
                var old = await _context.CarVideoStreams.FirstOrDefaultAsync(v => v.CarId == carId && v.StreamId == streamId);
                if (old != null) 
                    _context.CarVideoStreams.Remove(old);
            }
        }
        s.Name = body.Name ?? s.Name;
        s.Type = body.Type ?? s.Type;
        s.Location = body.Location;
        s.Enabled = body.Enabled;
        s.IsActive = body.Enabled;
        if (body.Width.HasValue) s.Width = body.Width.Value;
        if (body.Height.HasValue) s.Height = body.Height.Value;
        if (body.Framerate.HasValue) s.Framerate = body.Framerate.Value;
        if (body.BitrateKbps.HasValue) s.Bitrate = body.BitrateKbps.Value;
        if (body.Brightness.HasValue) s.Brightness = body.Brightness.Value;
        if (body.Priority.HasValue) s.Priority = body.Priority.Value;
        if (body.Port.HasValue) s.Port = body.Port.Value;
        if (body.JanusPort.HasValue) s.JanusPort = body.JanusPort;
        if (body.Protocol.HasValue) s.Protocol = body.Protocol.Value;
        s.CameraDevice = body.CameraDevice;
        s.RpiCamId = body.RpiCamId;
        s.OptionsJson = SerializeOptions(body.Options);
        s.ProcessArguments = body.ProcessArguments;
        s.StreamPurpose = body.StreamPurpose;
        s.Description = body.Description;
        s.LastStatusUpdate = DateTime.UtcNow;
        s.ModifiedAt = DateTime.UtcNow;
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        var mapItem = ToMapItem(s);
        await _controlHub.Clients.Group($"Car-{carId}").UpsertVideoStream(s.StreamId, mapItem);
        _logger.LogInformation("Upsert video stream {Stream} for car {CarId} by {User}", s.StreamId, carId, user.LoginName);
        return Ok(mapItem);
    }

    [HttpDelete("video/{streamId}")]
    public async Task<IActionResult> DeleteVideo(int carId, string streamId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var s = await _context.CarVideoStreams.FirstOrDefaultAsync(v => v.CarId == carId && v.StreamId == streamId);
        if (s == null) return NotFound();
        _context.CarVideoStreams.Remove(s);
        await _context.SaveChangesAsync();
        await UpdateCarChannelMapHashAsync(carId);

        await _controlHub.Clients.Group($"Car-{carId}").DeleteVideoStream(streamId);
        _logger.LogInformation("Delete video stream {Stream} for car {CarId} by {User}", streamId, carId, user.LoginName);
        return NoContent();
    }

    // ponytail: empty array when the Onboard hasn't reported yet (offline or
    // pre-handshake). The browser treats "no entries" as "no autocomplete"
    // and falls back to free-text input — same UX as before the endpoint
    // existed. We don't 404 because a transient offline Onboard shouldn't
    // be a hard error on every page load.
    // ponytail: returns numeric server ids keyed by channel name so test/debug UIs can
    // invoke the bandwidth-efficient UpdateChannel(int channelId, ...) hub method.
    [HttpGet("ids")]
    public async Task<IActionResult> GetChannelIds(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound("Car not found");

        var controls = await _context.CarChannels.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();
        var telemetries = await _context.CarTelemetry.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();
        var videos = await _context.CarVideoStreams.AsNoTracking().Where(c => c.CarId == carId).ToListAsync();

        return Ok(new
        {
            control = controls.ToDictionary(c => c.ChannelName, c => c.Id),
            telemetry = telemetries.ToDictionary(t => t.ChannelName, t => t.Id),
            video = videos.ToDictionary(v => v.StreamId, v => v.Id),
        });
    }

    [HttpGet("available-control-types")]
    public async Task<IActionResult> GetAvailableControlTypes(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        return Ok(_availableTypes.Get(carId)?.ControlTypes ?? Array.Empty<string>());
    }

    [HttpGet("available-telemetry-types")]
    public async Task<IActionResult> GetAvailableTelemetryTypes(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        return Ok(_availableTypes.Get(carId)?.TelemetryTypes ?? Array.Empty<string>());
    }

    private async Task UpdateCarChannelMapHashAsync(int carId)
    {
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return;

        var map = await ChannelMapMapper.FromDbAsync(carId, _context);
        car.ChannelMapHash = ChannelMapHashProvider.GenerateHash(map);
        await _context.SaveChangesAsync();
    }

    private async Task PushFullChannelMapAsync(int carId)
    {
        var map = await ChannelMapMapper.FromDbAsync(carId, _context);
        var hash = ChannelMapHashProvider.GenerateHash(map);
        await _controlHub.Clients.Group($"Car-{carId}").ApplyChannelMap(map, hash);
    }

    private static ControlChannelMapItem ToMapItem(CarChannel ch) => new()
    {
        PinManager = ch.PinManager,
        Address = ch.Address,
        ControlType = ch.ControlType ?? string.Empty,
        MaxResendInterval = ch.MaxResendInterval,
        TestDisabled = ch.TestDisabled,
        Options = DeserializeOptions(ch.OptionsJson),
        ModifiedAt = ch.ModifiedAt,
    };

    private static TelemetryChannelMapItem ToMapItem(CarTelemetry t) => new()
    {
        PinManager = t.PinManager,
        Address = t.Address,
        ReadIntervalTicks = t.ReadIntervalTicks,
        TelemetryType = t.TelemetryType,
        DataType = t.DataType,
        Unit = t.Unit,
        Decimals = t.Decimals,
        Options = DeserializeOptions(t.OptionsJson),
        ModifiedAt = t.ModifiedAt,
    };

    private static VideoStreamMapItem ToMapItem(CarVideoStream s) => new()
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
        CameraDevice = s.CameraDevice,
        RpiCamId = s.RpiCamId,
        Options = DeserializeOptions(s.OptionsJson),
        ModifiedAt = s.ModifiedAt,
    };

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

public class ControlChannelDto
{
    public string? ChannelName { get; set; }
    public string? DisplayName { get; set; }
    public bool IsEnabled { get; set; }
    public bool RequiresAxis { get; set; }
    public int? MaxResendInterval { get; set; }
    public string? ControlType { get; set; }
    public string? PinManager { get; set; }
    public int? Address { get; set; }
    public Dictionary<string, object>? Options { get; set; }
    public bool? TestDisabled { get; set; }
}

public class PinManagerDto
{
    public string? Name { get; set; }
    public string? Type { get; set; }
    public Dictionary<string, object>? Options { get; set; }
}

public class TelemetryChannelDto
{
    public string? ChannelName { get; set; }
    public int ReadIntervalTicks { get; set; }
    public string? TelemetryType { get; set; }
    public LteCar.Shared.Channels.TelemetryDataType DataType { get; set; }
    public string? Unit { get; set; }
    public byte? Decimals { get; set; }
    public string? PinManager { get; set; }
    public int? Address { get; set; }
    public Dictionary<string, object>? Options { get; set; }
}

public class VideoStreamDto
{
    public string? StreamId { get; set; }
    public string? Name { get; set; }
    public string? Type { get; set; }
    public string? Location { get; set; }
    public bool Enabled { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public int? Framerate { get; set; }
    public int? BitrateKbps { get; set; }
    public float? Brightness { get; set; }
    public int? Priority { get; set; }
    public int? Port { get; set; }
    public int? JanusPort { get; set; }
    public LteCar.Shared.Video.StreamProtocol? Protocol { get; set; }
    public string? ProcessArguments { get; set; }
    public string? StreamPurpose { get; set; }
    public string? Description { get; set; }
    public string? CameraDevice { get; set; }
    public int? RpiCamId { get; set; }
    public Dictionary<string, object>? Options { get; set; }
}