using System.Diagnostics;
using LteCar.Server.Hubs;
using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.HubClients;
using LteCar.Shared.Hubs;
using LteCar.Shared.Video;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Video;

// public class CameraProcessInfo
// {
//     public Process? Process { get; set; }
//     public VideoSettings VideoSettings { get; set; }
//     public int RestartCount { get; set; } = 0;
//     public DateTime StartTime { get; set; } = DateTime.Now;
//     public bool IsProcessRunning => Process != null && !Process.HasExited;

//     public CameraProcessInfo(VideoSettings videoSettings)
//     {
//         VideoSettings = videoSettings;
//     }
// }

public class VideoStreamService : ICarVideoClient, IHubConnectionObserver
{
    public ILogger<VideoStreamService> Logger { get; }
    public ServerCarConfigurationService ConfigService { get; }
    public ServerConnectionService ServerConnectionService { get; }
    public IConfiguration Configuration { get; }
    public IConnectionHubServer CarVideoServer { get; set; } = null!;
    private readonly ChannelMap _channelMap;
    private readonly IMediaMtxConfigurator _mediaMtxConfigurator;

    public VideoStreamService(
        ILogger<VideoStreamService> logger,
        ServerCarConfigurationService configService,
        ServerConnectionService serverConnectionService,
        IConfiguration configuration,
        ChannelMap channelMap,
        IMediaMtxConfigurator mediaMtxConfigurator)
    {
        Logger = logger;
        ConfigService = configService;
        ServerConnectionService = serverConnectionService;
        Configuration = configuration;
        _channelMap = channelMap;
        _mediaMtxConfigurator = mediaMtxConfigurator;
    }

    public void RestartCameraProcesses()
    {
        RestartCameraProcessesAsync().Wait();
    }

    private async Task RestartCameraProcessesAsync()
    {
        Logger.LogInformation("Rebuilding MediaMTX config for {Count} active video streams.",_channelMap.VideoStreams.Count(e => e.Value.Enabled));
        await _mediaMtxConfigurator.GenerateFromChannelMapAsync(_channelMap);
        // await _mediaMtxConfigurator.StopAsync();
        // await _mediaMtxConfigurator.StartProcessAsync();
    }
    


    public async Task OnClosed(Exception? exception)
    {
        Logger.LogWarning("VideoStreamService is closed.");
        // await _mediaMtxConfigurator.StopAsync();
    }

    public async Task OnReconnected(string? connectionId)
    {
        Logger.LogInformation("VideoStreamService reconnected. ConnectionId: {ConnectionId}", connectionId);
        await CarVideoServer.ConnectCar(Configuration.GetValue<string>("CarIdentityKey")!);
    }

    public async Task OnReconnecting(Exception? exception)
    {
        Logger.LogWarning("VideoStreamService tries to reconnect...");
    }

    public async Task Connect()
    {
        CarVideoServer = ServerConnectionService.GetProxy();
        await CarVideoServer.ConnectCar(Configuration.GetValue<string>("CarIdentityKey")!);
    }

    public async Task StopVideoStream(string streamId)
    {
        var selectedStream = await GetStream(streamId);
        if (selectedStream == null)
            return;

        selectedStream.Enabled = false;
        Logger.LogInformation($"Stream: {streamId} disabled.");

        await _mediaMtxConfigurator.GenerateFromChannelMapAsync(_channelMap);
    }

    public async Task StartVideoStream(string streamId)
    {
        var selectedStream = await GetStream(streamId);
        if (selectedStream == null)
            return;

        selectedStream.Enabled = true;
        Logger.LogInformation($"Stream: {streamId} started.");

        await _mediaMtxConfigurator.GenerateFromChannelMapAsync(_channelMap);
    }

    private async Task<VideoStreamMapItem?> GetStream(string streamId)
    {
        if (!_channelMap.VideoStreams.TryGetValue(streamId, out var selectedStream))
        {
            if (this.ConfigService.ServerAssignedCarId == null)
            {
                Logger.LogError($"Unknown video stream update requested and no server Car ID set yet! ({streamId})");
                return null;
            }
            Logger.LogWarning($"Syncronizing streams for update...");
            var allStreams = await CarVideoServer.GetVideoStreamsForCar(this.ConfigService.ServerAssignedCarId.Value);
            var unnamedCounter = 0;
            _channelMap.VideoStreams = allStreams.ToDictionary(s => !string.IsNullOrEmpty(s.StreamId) ? s.StreamId : (unnamedCounter++).ToString(), s => s);
            if (!_channelMap.VideoStreams.TryGetValue(streamId, out selectedStream))
            {
                Logger.LogError($"Update to unknown stream requested: '{streamId}'!");
                return null;
            }
        }
        return selectedStream;
    }

    public async Task UpdateVideoStream(string streamId, VideoStreamMapItem settings)
    {
        var selectedStream = await GetStream(streamId);
        if (selectedStream == null)
            return;

        selectedStream.ServerId = settings.ServerId;
        selectedStream.StreamId = settings.StreamId;
        selectedStream.Name = settings.Name;
        selectedStream.Location = settings.Location;
        selectedStream.Type = settings.Type;
        selectedStream.Enabled = settings.Enabled;
        selectedStream.CameraDevice = settings.CameraDevice;
        selectedStream.RpiCamId = settings.RpiCamId;
        selectedStream.Width = settings.Width;
        selectedStream.Height = settings.Height;
        selectedStream.Framerate = settings.Framerate;
        selectedStream.Bitrate = settings.Bitrate;
        selectedStream.Options = settings.Options;
        selectedStream.ModifiedAt = settings.ModifiedAt;
        selectedStream.Gain = settings.Gain;
        selectedStream.Shutter = settings.Shutter;
        selectedStream.Brightness = settings.Brightness;
        selectedStream.Contrast = settings.Contrast;
        selectedStream.EV = settings.EV;
        selectedStream.Exposure = settings.Exposure;
        selectedStream.Port = settings.Port;
        Logger.LogInformation($"Stream: {streamId} updated.");

        await _mediaMtxConfigurator.GenerateFromChannelMapAsync(_channelMap);
    }
}
