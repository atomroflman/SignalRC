using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Shared.Audio;
using SignalRC.Shared.HubClients;

namespace SignalRC.Server.Services;

/// <summary>
/// Car-level audio on the server side:
/// <list type="bullet">
/// <item>Listening: browsers register as listeners; while a car has at least one and a microphone is
/// configured, its audio-only Janus mountpoint exists and the Onboard sends the microphone to it.</item>
/// <item>Settings: <see cref="AudioSettings"/> are built from the <see cref="Car"/> row and pushed to the
/// Onboard on every (re)connect and change.</item>
/// </list>
/// </summary>
public class CarAudioService
{
    // Video mountpoints use their CarVideoStream id; car audio lives in its own id range.
    public const int MountpointIdOffset = 1_000_000;
    public static int MountpointId(int carId) => MountpointIdOffset + carId;

    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _hub;
    private readonly CarConnectionStore _connectionStore;
    private readonly VideoStreamReceiverService _streamService;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<CarAudioService> _logger;

    // Same bookkeeping as video viewers, keyed by car id instead of stream id.
    private readonly ActiveVideoStreamViewerRegistry _listeners = new();
    // Cars whose audio mountpoint currently exists.
    private readonly ConcurrentDictionary<int, byte> _running = new();
    // Last status the Onboard reported, handed to browsers that subscribe later.
    private readonly ConcurrentDictionary<int, AudioStatus> _lastStatus = new();
    private readonly ConcurrentDictionary<int, SemaphoreSlim> _carLocks = new();

    public CarAudioService(
        IHubContext<CarConnectionHub, IConnectionHubClient> hub,
        CarConnectionStore connectionStore,
        VideoStreamReceiverService streamService,
        IServiceScopeFactory scopeFactory,
        ILogger<CarAudioService> logger)
    {
        _hub = hub;
        _connectionStore = connectionStore;
        _streamService = streamService;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    public static AudioSettings ToSettings(Car car) => new AudioSettings
    {
        InputDevice = car.AudioInputDevice,
        InputChannel = car.AudioInputChannel,
        InputGain = car.AudioInputGain,
        Denoise = car.AudioDenoise,
        BitrateKbps = car.AudioBitrateKbps,
        OutputDevice = car.AudioOutputDevice,
        OutputVolume = car.AudioOutputVolume,
        MuteInputWhileTalking = car.AudioMuteInputWhileTalking,
    }.Normalized();

    public static void ApplyToCar(Car car, AudioSettings settings)
    {
        var s = settings.Normalized();
        car.AudioInputDevice = s.InputDevice;
        car.AudioInputChannel = s.InputChannel;
        car.AudioInputGain = s.InputGain;
        car.AudioDenoise = s.Denoise;
        car.AudioBitrateKbps = s.BitrateKbps;
        car.AudioOutputDevice = s.OutputDevice;
        car.AudioOutputVolume = s.OutputVolume;
        car.AudioMuteInputWhileTalking = s.MuteInputWhileTalking;
    }

    /// <summary>
    /// Registers a listening browser connection. Returns the Janus mountpoint id to watch, or null when
    /// the car has no microphone configured. Throws when the mountpoint can't be created (Janus down),
    /// so the browser shows an error and retries.
    /// </summary>
    public async Task<int?> AddListenerAsync(int carId, string connectionId)
    {
        _listeners.Activate(connectionId, carId);
        _logger.LogInformation("Connection {ConnectionId} listens to car {CarId}. Listeners: {Count}", connectionId, carId, _listeners.GetViewerCount(carId));
        return await ReconcileAsync(carId) ? MountpointId(carId) : null;
    }

    public async Task RemoveListenerAsync(int carId, string connectionId)
    {
        if (_listeners.Deactivate(connectionId, carId))
            await TryReconcileAsync(carId);
    }

    public async Task RemoveConnectionAsync(string connectionId)
    {
        foreach (var carId in _listeners.RemoveConnection(connectionId))
            await TryReconcileAsync(carId);
    }

    /// <summary>
    /// The Onboard (re)connected: give it the current settings and, if someone listens, restart the uplink.
    /// Both go out on the car's own connection, so they arrive in this order.
    /// </summary>
    public async Task OnCarConnectedAsync(int carId)
    {
        var car = await LoadCarAsync(carId);
        if (car == null || !TryGetCarClient(carId, out var client))
            return;
        await client.ApplyAudioSettings(ToSettings(car));
        if (_running.ContainsKey(carId) && _streamService.GetAudioPort(carId) is { } port)
            await client.StartAudioUplink(port);
        await client.SyncSoundFiles(await LoadSoundFilesAsync(carId));
    }

    /// <summary>
    /// The sound library changed: the Onboard fetches what is new and drops what is gone.
    /// </summary>
    public async Task OnSoundFilesChangedAsync(int carId)
    {
        if (TryGetCarClient(carId, out var client))
            await client.SyncSoundFiles(await LoadSoundFilesAsync(carId));
    }

    private async Task<SoundFileInfo[]> LoadSoundFilesAsync(int carId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        return await db.CarSoundFiles.AsNoTracking()
            .Where(f => f.CarId == carId)
            .OrderBy(f => f.FileName)
            .Select(f => new SoundFileInfo { Name = f.FileName, Sha256 = f.Sha256, SizeBytes = f.SizeBytes })
            .ToArrayAsync();
    }

    /// <summary>
    /// The Onboard went away: whatever it reported last is no longer playing.
    /// </summary>
    public async Task OnCarDisconnectedAsync(int carId)
    {
        if (_lastStatus.TryRemove(carId, out _))
            await _hub.Clients.Group(StatusGroup(carId)).AudioStatusUpdated(carId, new AudioStatus());
    }

    /// <summary>
    /// Settings were changed in the UI: push them to the Onboard and start or stop listening accordingly.
    /// </summary>
    public async Task OnSettingsChangedAsync(int carId)
    {
        var car = await LoadCarAsync(carId);
        if (car == null)
            return;
        if (TryGetCarClient(carId, out var client))
            await client.ApplyAudioSettings(ToSettings(car));
        await TryReconcileAsync(carId);
    }

    public static string StatusGroup(int carId) => $"audio:{carId}";

    public AudioStatus? GetLastStatus(int carId) => _lastStatus.TryGetValue(carId, out var status) ? status : null;

    /// <summary>
    /// Relays an Onboard status report to the browsers subscribed to <see cref="StatusGroup"/>.
    /// </summary>
    public async Task PublishStatusAsync(int carId, AudioStatus status)
    {
        _lastStatus[carId] = status;
        await _hub.Clients.Group(StatusGroup(carId)).AudioStatusUpdated(carId, status);
    }

    /// <summary>
    /// Brings mountpoint and uplink in line with "someone listens and a microphone is configured".
    /// Returns whether the car's audio is (now) running.
    /// </summary>
    private async Task<bool> ReconcileAsync(int carId)
    {
        var carLock = _carLocks.GetOrAdd(carId, _ => new SemaphoreSlim(1, 1));
        await carLock.WaitAsync();
        try
        {
            var car = await LoadCarAsync(carId);
            var wanted = car != null
                && !string.IsNullOrWhiteSpace(car.AudioInputDevice)
                && _listeners.GetViewerCount(carId) > 0;
            var running = _running.ContainsKey(carId);
            var hasClient = TryGetCarClient(carId, out var client);

            if (wanted && !running)
            {
                var port = await _streamService.OpenCarAudioMountpointAsync(carId, MountpointId(carId), $"{car!.Name ?? carId.ToString()}-audio");
                _running[carId] = 0;
                if (hasClient)
                    await client.StartAudioUplink(port);
            }
            else if (!wanted && running)
            {
                if (hasClient)
                    await client.StopAudioUplink();
                await _streamService.CloseCarAudioMountpointAsync(carId, MountpointId(carId));
                _running.TryRemove(carId, out _);
                _logger.LogInformation("Audio of car {CarId} stopped (no listeners or no microphone)", carId);
            }
            return wanted;
        }
        finally
        {
            carLock.Release();
        }
    }

    private async Task TryReconcileAsync(int carId)
    {
        try
        {
            await ReconcileAsync(carId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update audio of car {CarId}", carId);
        }
    }

    private bool TryGetCarClient(int carId, out IConnectionHubClient client)
    {
        if (_connectionStore.TryGetValue(carId.ToString(), out var info) && !string.IsNullOrEmpty(info.ConnectionId))
        {
            client = _hub.Clients.Client(info.ConnectionId);
            return true;
        }
        client = null!;
        return false;
    }

    private async Task<Car?> LoadCarAsync(int carId)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        return await db.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == carId);
    }
}
