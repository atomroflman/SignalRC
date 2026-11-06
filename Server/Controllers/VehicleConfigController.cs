using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Server.Security;
using SignalRC.Server.Services;
using SignalRC.Server.Telemetry.History;
using SignalRC.Shared;
using SignalRC.Shared.Audio;
using SignalRC.Shared.Channels;
using SignalRC.Shared.HubClients;

namespace SignalRC.Server.Controllers;

/// <summary>
/// Export and import of the whole vehicle configuration (setup page): pin managers,
/// control, telemetry and video channels and the audio settings (<see cref="VehicleConfigFile"/>).
/// The import first answers with a plan (dryRun) and only writes on the second call; channels
/// the file lacks are removed only with removeMissing. One transaction, one push to the vehicle.
/// </summary>
[ApiController]
[Route("api/cars/{carId:int}/config")]
[RequireVehicle]
public class VehicleConfigController : ControllerBase
{
    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _controlHub;
    private readonly CarAudioService _carAudio;
    private readonly VideoStreamActivationService _streamActivation;
    private readonly TelemetryChannelsChanged _telemetryChannelsChanged;
    private readonly ILogger<VehicleConfigController> _logger;

    public VehicleConfigController(
        SignalRCContext context,
        IHubContext<CarConnectionHub, IConnectionHubClient> controlHub,
        CarAudioService carAudio,
        VideoStreamActivationService streamActivation,
        TelemetryChannelsChanged telemetryChannelsChanged,
        ILogger<VehicleConfigController> logger) : base(context)
    {
        _controlHub = controlHub;
        _carAudio = carAudio;
        _streamActivation = streamActivation;
        _telemetryChannelsChanged = telemetryChannelsChanged;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> Export(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found");
        return Ok(new VehicleConfigFile
        {
            ExportedAt = DateTime.UtcNow,
            CarId = carId,
            CarName = car.Name,
            PinManagers = (await _context.CarPinManagers.AsNoTracking().Where(p => p.CarId == carId).OrderBy(p => p.Name).ToListAsync()).Select(VehicleConfigMapper.ToDto).ToList(),
            ControlChannels = (await _context.CarChannels.AsNoTracking().Where(c => c.CarId == carId).OrderBy(c => c.ChannelName).ToListAsync()).Select(VehicleConfigMapper.ToDto).ToList(),
            TelemetryChannels = (await _context.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId).OrderBy(t => t.ChannelName).ToListAsync()).Select(VehicleConfigMapper.ToDto).ToList(),
            VideoStreams = (await _context.CarVideoStreams.AsNoTracking().Where(s => s.CarId == carId).OrderBy(s => s.StreamId).ToListAsync()).Select(VehicleConfigMapper.ToDto).ToList(),
            Audio = CarAudioService.ToSettings(car),
        });
    }

    public class ImportSection
    {
        [JsonPropertyName("kind")] public string Kind { get; set; } = string.Empty;
        [JsonPropertyName("added")] public List<string> Added { get; set; } = new();
        [JsonPropertyName("changed")] public List<string> Changed { get; set; } = new();
        [JsonPropertyName("unchanged")] public List<string> Unchanged { get; set; } = new();
        /// <summary>On the vehicle but not in the file: removed only with removeMissing.</summary>
        [JsonPropertyName("missing")] public List<string> Missing { get; set; } = new();
    }

    public class ImportPlan
    {
        [JsonPropertyName("applied")] public bool Applied { get; set; }
        [JsonPropertyName("removeMissing")] public bool RemoveMissing { get; set; }
        [JsonPropertyName("sourceCarId")] public int SourceCarId { get; set; }
        [JsonPropertyName("sourceCarName")] public string? SourceCarName { get; set; }
        [JsonPropertyName("exportedAt")] public DateTime ExportedAt { get; set; }
        [JsonPropertyName("sections")] public List<ImportSection> Sections { get; set; } = new();
        [JsonPropertyName("audioChanged")] public bool AudioChanged { get; set; }
        /// <summary>Control channels whose removal also removes flow nodes (output nodes of user flows).</summary>
        [JsonPropertyName("flowNodesRemoved")] public int FlowNodesRemoved { get; set; }
    }

    /// <summary>Validation of a file; null when it is fine.</summary>
    public static string? Validate(VehicleConfigFile? file)
    {
        if (file == null) return "No configuration in the file.";
        if (file.Format != VehicleConfigFile.FormatName) return $"Not a SignalRC vehicle configuration (format '{file.Format}').";
        if (file.Version < 1 || file.Version > VehicleConfigFile.CurrentVersion) return $"Configuration version {file.Version} is not supported (up to {VehicleConfigFile.CurrentVersion}).";
        string? Dupes(string kind, IEnumerable<string?> names)
        {
            var list = names.ToList();
            if (list.Any(string.IsNullOrWhiteSpace)) return $"{kind}: an entry has no name.";
            var dupe = list.GroupBy(n => n).FirstOrDefault(g => g.Count() > 1);
            return dupe != null ? $"{kind}: '{dupe.Key}' appears twice." : null;
        }
        return Dupes("Pin managers", file.PinManagers.Select(p => p.Name))
            ?? Dupes("Control channels", file.ControlChannels.Select(c => c.ChannelName))
            ?? Dupes("Telemetry channels", file.TelemetryChannels.Select(t => t.ChannelName))
            ?? Dupes("Video streams", file.VideoStreams.Select(v => v.StreamId));
    }

    /// <summary>Compares what is there with what the file says, by name.</summary>
    public static ImportSection Compare<TDto>(string kind, IReadOnlyDictionary<string, TDto> current, IReadOnlyDictionary<string, TDto> imported)
    {
        var section = new ImportSection { Kind = kind };
        foreach (var (name, dto) in imported.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            if (!current.TryGetValue(name, out var existing)) section.Added.Add(name);
            else if (VehicleConfigMapper.Same(existing, dto)) section.Unchanged.Add(name);
            else section.Changed.Add(name);
        }
        section.Missing.AddRange(current.Keys.Where(n => !imported.ContainsKey(n)).OrderBy(n => n, StringComparer.Ordinal));
        return section;
    }

    [HttpPost("import")]
    public async Task<IActionResult> Import(int carId, [FromBody] VehicleConfigFile? file, [FromQuery] bool dryRun = true, [FromQuery] bool removeMissing = false)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found");
        var error = Validate(file);
        if (error != null) return BadRequest(error);

        var pinManagers = await _context.CarPinManagers.Where(p => p.CarId == carId).ToDictionaryAsync(p => p.Name);
        var controls = await _context.CarChannels.Where(c => c.CarId == carId).ToDictionaryAsync(c => c.ChannelName);
        var telemetries = await _context.CarTelemetry.Where(t => t.CarId == carId).ToDictionaryAsync(t => t.ChannelName);
        var streams = await _context.CarVideoStreams.Where(s => s.CarId == carId).ToDictionaryAsync(s => s.StreamId);

        var importedPins = file!.PinManagers.ToDictionary(p => p.Name!);
        var importedControls = file.ControlChannels.ToDictionary(c => c.ChannelName!);
        var importedTelemetry = file.TelemetryChannels.ToDictionary(t => t.ChannelName!);
        var importedStreams = file.VideoStreams.ToDictionary(v => v.StreamId!);
        if (file.CarId != carId)
        {
            // Ports are the server's per-stream assignment (Janus port range): another vehicle's
            // ports would collide. Existing streams keep theirs, new ones get free ports on start.
            foreach (var (name, dto) in importedStreams)
            {
                streams.TryGetValue(name, out var existing);
                dto.Port = existing?.Port;
                dto.JanusPort = existing?.JanusPort;
            }
        }

        var plan = new ImportPlan
        {
            RemoveMissing = removeMissing,
            SourceCarId = file.CarId,
            SourceCarName = file.CarName,
            ExportedAt = file.ExportedAt,
            Sections =
            {
                Compare("pinManagers", pinManagers.ToDictionary(kv => kv.Key, kv => VehicleConfigMapper.ToDto(kv.Value)), importedPins),
                Compare("controlChannels", controls.ToDictionary(kv => kv.Key, kv => VehicleConfigMapper.ToDto(kv.Value)), importedControls),
                Compare("telemetryChannels", telemetries.ToDictionary(kv => kv.Key, kv => VehicleConfigMapper.ToDto(kv.Value)), importedTelemetry),
                Compare("videoStreams", streams.ToDictionary(kv => kv.Key, kv => VehicleConfigMapper.ToDto(kv.Value)), importedStreams),
            },
            AudioChanged = file.Audio != null && !VehicleConfigMapper.Same(CarAudioService.ToSettings(car), file.Audio.Normalized()),
        };
        var removedControlIds = removeMissing ? controls.Where(kv => !importedControls.ContainsKey(kv.Key)).Select(kv => kv.Value.Id).ToList() : new List<int>();
        plan.FlowNodesRemoved = removedControlIds.Count == 0 ? 0
            : await _context.Set<UserSetupCarChannelNode>().CountAsync(n => removedControlIds.Contains(n.CarChannelId));
        if (dryRun) return Ok(plan);

        // -- Apply ------------------------------------------------------------------------
        var streamsToActivate = new List<CarVideoStream>();
        var streamsToStop = new List<CarVideoStream>();

        foreach (var (name, dto) in importedPins)
        {
            if (!pinManagers.TryGetValue(name, out var pm))
                _context.CarPinManagers.Add(pm = new CarPinManager { CarId = carId, Name = name });
            VehicleConfigMapper.Apply(pm, dto);
        }
        foreach (var (name, dto) in importedControls)
        {
            if (!controls.TryGetValue(name, out var ch))
                _context.CarChannels.Add(ch = new CarChannel { CarId = carId, ChannelName = name });
            VehicleConfigMapper.Apply(ch, dto);
        }
        foreach (var (name, dto) in importedTelemetry)
        {
            if (!telemetries.TryGetValue(name, out var t))
                _context.CarTelemetry.Add(t = new CarTelemetry { CarId = carId, ChannelName = name });
            VehicleConfigMapper.Apply(t, dto);
        }
        foreach (var (name, dto) in importedStreams)
        {
            var isNew = !streams.TryGetValue(name, out var s);
            if (isNew) _context.CarVideoStreams.Add(s = VehicleConfigMapper.NewStream(carId, name, dto));
            var wasEnabled = !isNew && s!.Enabled;
            var previousPort = isNew ? -1 : s!.Port;
            VehicleConfigMapper.Apply(s!, dto);
            if (isNew || wasEnabled != s!.Enabled || previousPort != s.Port) streamsToActivate.Add(s!);
        }
        if (file.Audio != null) CarAudioService.ApplyToCar(car, file.Audio);

        if (removeMissing)
        {
            _context.CarPinManagers.RemoveRange(pinManagers.Where(kv => !importedPins.ContainsKey(kv.Key)).Select(kv => kv.Value));
            _context.Set<UserSetupCarChannelNode>().RemoveRange(
                await _context.Set<UserSetupCarChannelNode>().Where(n => removedControlIds.Contains(n.CarChannelId)).ToListAsync());
            _context.CarChannels.RemoveRange(controls.Where(kv => !importedControls.ContainsKey(kv.Key)).Select(kv => kv.Value));
            _context.CarTelemetry.RemoveRange(telemetries.Where(kv => !importedTelemetry.ContainsKey(kv.Key)).Select(kv => kv.Value));
            streamsToStop.AddRange(streams.Where(kv => !importedStreams.ContainsKey(kv.Key)).Select(kv => kv.Value));
        }
        // Before the rows go: tearing down a Janus mountpoint looks the stream up.
        foreach (var s in streamsToStop)
            await _streamActivation.StopAsync(carId, s.StreamId, s.Id);
        _context.CarVideoStreams.RemoveRange(streamsToStop);

        await using (var tx = await _context.Database.BeginTransactionAsync())
        {
            await _context.SaveChangesAsync();
            var map = await ChannelMapMapper.FromDbAsync(carId, _context);
            car.ChannelMapHash = ChannelMapHashProvider.GenerateHash(map);
            await _context.SaveChangesAsync();
            await tx.CommitAsync();
        }

        var pushed = await ChannelMapMapper.FromDbAsync(carId, _context);
        await _controlHub.Clients.Group($"Car-{carId}").ApplyChannelMap(pushed, ChannelMapHashProvider.GenerateHash(pushed));
        await _telemetryChannelsChanged.NotifyAsync(carId);
        foreach (var s in streamsToActivate) await _streamActivation.ApplyAsync(s.Id);
        if (file.Audio != null) await _carAudio.OnSettingsChangedAsync(carId);

        plan.Applied = true;
        _logger.LogInformation("Configuration imported into car {CarId} by {User} (from car {Source}, removeMissing {Remove})",
            carId, user.LoginName, file.CarId, removeMissing);
        return Ok(plan);
    }
}
