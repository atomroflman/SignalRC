using Microsoft.AspNetCore.SignalR;
using LteCar.Server.Data;
using LteCar.Shared;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Hubs;

public interface IAudioChatClient
{
    Task AudioStreamStatusChanged(int carId, string streamId, bool isActive);
    Task AudioDeviceListReceived(int carId, AudioDeviceInfo[] devices);
    Task AudioError(int carId, string error);
}

public interface IAudioChatServer
{
    Task ConnectCar(string carIdentityKey);
    Task DisconnectCar(string carIdentityKey);
    Task StartAudioStream(int carId, string streamId, AudioStreamSettings settings);
    Task StopAudioStream(int carId, string streamId);
    Task GetAudioDevices(int carId);
    Task SetAudioDevice(int carId, string deviceId);
    Task SetAudioEnabled(int carId, bool enabled);
    Task SetRecordingEnabled(int carId, bool recording);
}

public class AudioDeviceInfo
{
    public string DeviceId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Kind { get; set; } = string.Empty;
    public bool IsDefault { get; set; }
}

public class AudioStreamSettings
{
    public string AudioInputDeviceId { get; set; } = string.Empty;
    public string AudioOutputDeviceId { get; set; } = string.Empty;
    public int SampleRate { get; set; } = 48000;
    public int ChannelCount { get; set; } = 1;
    public bool EchoCancellation { get; set; } = true;
    public bool NoiseSuppression { get; set; } = true;
    public int Bitrate { get; set; } = 64000;
}

public class CarAudioHub : Hub<IAudioChatClient>, IAudioChatServer
{
    private readonly LteCarContext _context;
    private readonly ILogger<CarAudioHub> _logger;

    public CarAudioHub(LteCarContext context, ILogger<CarAudioHub> logger)
    {
        _context = context;
        _logger = logger;
    }

    public async Task ConnectCar(string carIdentityKey)
    {
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.CarIdentityKey == carIdentityKey);
        if (car == null)
        {
            _logger.LogWarning("Car with identity key {CarIdentityKey} not found", carIdentityKey);
            throw new InvalidOperationException($"Car with identity key {carIdentityKey} not found!");
        }
        
        await Groups.AddToGroupAsync(Context.ConnectionId, $"CarAudio-{car.Id}");
        await Clients.Group($"CarAudio-{car.Id}").AudioStreamStatusChanged(car.Id, "connection", true);
        _logger.LogInformation("Car {CarId} connected to audio hub", car.Id);
    }

    public async Task DisconnectCar(string carIdentityKey)
    {
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.CarIdentityKey == carIdentityKey);
        if (car == null)
        {
            return;
        }
        
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"CarAudio-{car.Id}");
        _logger.LogInformation("Car {CarId} disconnected from audio hub", car.Id);
    }

    public async Task StartAudioStream(int carId, string streamId, AudioStreamSettings settings)
    {
        _logger.LogInformation("Starting audio stream {StreamId} for car {CarId}", streamId, carId);
        await Clients.Group($"CarAudio-{carId}").AudioStreamStatusChanged(carId, streamId, true);
    }

    public async Task StopAudioStream(int carId, string streamId)
    {
        _logger.LogInformation("Stopping audio stream {StreamId} for car {CarId}", streamId, carId);
        await Clients.Group($"CarAudio-{carId}").AudioStreamStatusChanged(carId, streamId, false);
    }

    public async Task GetAudioDevices(int carId)
    {
        _logger.LogInformation("Getting audio devices for car {CarId}", carId);
        await Clients.Group($"CarAudio-{carId}").AudioDeviceListReceived(carId, Array.Empty<AudioDeviceInfo>());
    }

    public async Task SetAudioDevice(int carId, string deviceId)
    {
        _logger.LogInformation("Setting audio device {DeviceId} for car {CarId}", deviceId, carId);
    }

    public async Task SetAudioEnabled(int carId, bool enabled)
    {
        _logger.LogInformation("Setting audio enabled {Enabled} for car {CarId}", enabled, carId);
    }

    public async Task SetRecordingEnabled(int carId, bool recording)
    {
        _logger.LogInformation("Setting recording enabled {Recording} for car {CarId}", recording, carId);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Audio hub client disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }
}

public static class AudioHubExtensions
{
    public static async Task AudioStreamStatusChanged(this IAudioChatClient client, int carId, string streamId, bool isActive)
    {
        await client.AudioStreamStatusChanged(carId, streamId, isActive);
    }
    
    public static async Task AudioDeviceListReceived(this IAudioChatClient client, int carId, AudioDeviceInfo[] devices)
    {
        await client.AudioDeviceListReceived(carId, devices);
    }
    
    public static async Task AudioError(this IAudioChatClient client, int carId, string error)
    {
        await client.AudioError(carId, error);
    }
}
