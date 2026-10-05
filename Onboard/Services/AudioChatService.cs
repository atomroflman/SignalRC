using LteCar.Shared.HubClients;
using LteCar.Shared.Hubs;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TypedSignalR.Client;

namespace LteCar.Onboard;

public class AudioChatService : VehicleServiceBase
{
    public override string ServiceName => "AudioChat";
    
    private readonly IConfiguration _configuration;
    private readonly ILogger<AudioChatService> _logger;
    private readonly ServerCarConfigurationService _carConfig;
    private HubConnection? _hubConnection;
    private IAudioChatServer? _server;
    private bool _isRecordingEnabled;
    private bool _isAudioEnabled;
    private string? _selectedAudioInputDeviceId;
    private string? _selectedAudioOutputDeviceId;

    #pragma warning disable CS0067
    public event EventHandler<AudioStreamStatusEventArgs>? AudioStreamStatusChanged;
    public event EventHandler<string>? AudioError;
    #pragma warning restore CS0067

    public AudioChatService(
        IConfiguration configuration,
        ILogger<AudioChatService> logger,
        ServerCarConfigurationService carConfig)
    {
        _configuration = configuration;
        _logger = logger;
        _carConfig = carConfig;
    }

    public override async Task OnConnectedAsync(HubConnection connection)
    {
        _hubConnection = connection;
        _server = connection.CreateHubProxy<IAudioChatServer>();
        
        var carIdentityKey = _configuration.GetValue<string>("CarIdentityKey");
        if (!string.IsNullOrEmpty(carIdentityKey))
        {
            await _server.ConnectCar(carIdentityKey);
            _logger.LogInformation("Connected to audio hub");
        }
    }

    public override async Task OnReconnectedAsync(HubConnection connection, string? connectionId)
    {
        _hubConnection = connection;
        _server = connection.CreateHubProxy<IAudioChatServer>();
        
        var carIdentityKey = _configuration.GetValue<string>("CarIdentityKey");
        if (!string.IsNullOrEmpty(carIdentityKey))
        {
            await _server.ConnectCar(carIdentityKey);
            _logger.LogInformation("Reconnected to audio hub");
        }
    }

    public async Task StartAudioStreamAsync(string streamId, AudioStreamSettings settings)
    {
        if (_server == null || _hubConnection?.State != HubConnectionState.Connected)
        {
            _logger.LogWarning("Cannot start audio stream - not connected to audio hub");
            return;
        }

        _selectedAudioInputDeviceId = settings.AudioInputDeviceId;
        _selectedAudioOutputDeviceId = settings.AudioOutputDeviceId;
        
        await _server.StartAudioStream(_carConfig.ServerAssignedCarId ?? 0, streamId, settings);
        _logger.LogInformation("Audio stream {StreamId} started with input device {DeviceId}", 
            streamId, settings.AudioInputDeviceId);
    }

    public async Task StopAudioStreamAsync(string streamId)
    {
        if (_server == null)
        {
            return;
        }

        await _server.StopAudioStream(_carConfig.ServerAssignedCarId ?? 0, streamId);
        _logger.LogInformation("Audio stream {StreamId} stopped", streamId);
    }

    public async Task GetAvailableAudioDevicesAsync()
    {
        if (_server == null)
        {
            return;
        }

        await _server.GetAudioDevices(_carConfig.ServerAssignedCarId ?? 0);
    }

    public async Task SetAudioInputDeviceAsync(string deviceId)
    {
        if (_server == null)
        {
            return;
        }

        _selectedAudioInputDeviceId = deviceId;
        await _server.SetAudioDevice(_carConfig.ServerAssignedCarId ?? 0, deviceId);
        _logger.LogInformation("Audio input device set to {DeviceId}", deviceId);
    }

    public async Task SetAudioOutputDeviceAsync(string deviceId)
    {
        if (_server == null)
        {
            return;
        }

        _selectedAudioOutputDeviceId = deviceId;
        await _server.SetAudioDevice(_carConfig.ServerAssignedCarId ?? 0, deviceId);
        _logger.LogInformation("Audio output device set to {DeviceId}", deviceId);
    }

    public async Task SetAudioEnabledAsync(bool enabled)
    {
        if (_server == null)
        {
            return;
        }

        _isAudioEnabled = enabled;
        await _server.SetAudioEnabled(_carConfig.ServerAssignedCarId ?? 0, enabled);
        _logger.LogInformation("Audio enabled set to {Enabled}", enabled);
    }

    public async Task SetRecordingEnabledAsync(bool recording)
    {
        if (_server == null)
        {
            return;
        }

        _isRecordingEnabled = recording;
        await _server.SetRecordingEnabled(_carConfig.ServerAssignedCarId ?? 0, recording);
        _logger.LogInformation("Recording enabled set to {Recording}", recording);
    }

    public bool IsRecordingEnabled => _isRecordingEnabled;
    public bool IsAudioEnabled => _isAudioEnabled;
    public string? SelectedAudioInputDeviceId => _selectedAudioInputDeviceId;
    public string? SelectedAudioOutputDeviceId => _selectedAudioOutputDeviceId;
}

public class AudioStreamStatusEventArgs : EventArgs
{
    public string StreamId { get; set; } = string.Empty;
    public bool IsActive { get; set; }
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
