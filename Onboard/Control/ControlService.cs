using CSharpVitamins;
using LteCar.Onboard.Data;
using LteCar.Onboard.Telemetry;
using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.FileTransfer;
using LteCar.Server.Hubs;
using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using TypedSignalR.Client;
using LteCar.Onboard;
using System.Diagnostics;

namespace LteCar.Onboard.Control;

public class ControlService : IControlClient, IHubConnectionObserver
{
    public IServiceProvider ServiceProvider { get; }
    public ILogger<ControlService> Logger { get; }
    public TelemetryService TelemetryService { get; }
    public ControlExecutionService Control { get; }
    public IConfiguration Configuration { get; }
    public ServerConnectionService ServerConnectionService { get; }
    public SshKeyService SshKeyService { get; }
    public ServerCarConfigurationService CarConfigurationService { get; }
    public OnboardChannelStore ChannelStore { get; }
    public ChannelMap ChannelMap { get; }
    public Process BashProcess { get; } = new Process();

    private string? _sessionId;
    private DateTime _lastControlUpdate = DateTime.Now;
    private IConnectionHubServer _server = null!;

    public ControlService(ILogger<ControlService> logger, TelemetryService telemetryService, ControlExecutionService control, IServiceProvider serviceProvider, IConfiguration configuration, ServerConnectionService serverConnectionService, SshKeyService sshKeyService, ServerCarConfigurationService carConfigurationService, OnboardChannelStore channelStore, ChannelMap channelMap)
    {
        Logger = logger;
        TelemetryService = telemetryService;
        Control = control;
        ServiceProvider = serviceProvider;
        Configuration = configuration;
        ServerConnectionService = serverConnectionService;
        SshKeyService = sshKeyService;
        CarConfigurationService = carConfigurationService;
        ChannelStore = channelStore;
        ChannelMap = channelMap;
        BashProcess.StartInfo.FileName = "/bin/bash";
        BashProcess.StartInfo.RedirectStandardInput = true;
        BashProcess.StartInfo.RedirectStandardOutput = true;
        BashProcess.StartInfo.RedirectStandardError = true;
        BashProcess.StartInfo.UseShellExecute = false;
        BashProcess.StartInfo.CreateNoWindow = true;
        BashProcess.OutputDataReceived += (sender, args) =>
        {
            if (!string.IsNullOrEmpty(args.Data))
            {
                Logger.LogInformation($"[Bash Output] {args.Data}");
                if (ServerConnectionService.IsConnected && this.CarConfigurationService.ServerAssignedCarId.HasValue && _server != null)
                {
                    _server.SendBashOutput(CarConfigurationService.ServerAssignedCarId!.Value, args.Data, false);
                }
            }
        };
        BashProcess.ErrorDataReceived += (sender, args) =>
        {
            if (!string.IsNullOrEmpty(args.Data))
            {
                Logger.LogError($"[Bash Error] {args.Data}");
                if (ServerConnectionService.IsConnected && this.CarConfigurationService.ServerAssignedCarId.HasValue && _server != null)
                {
                    _server.SendBashOutput(CarConfigurationService.ServerAssignedCarId!.Value, args.Data, true);
                }
            }
        };
        BashProcess.Start();
    }

    public void Initialize()
    {
        Control.Initialize();
        Control.ReleaseControl();
    }

    public async Task ExecuteBashCommand(string sessionId, string command)
    {
        if (_sessionId != sessionId)
            return;
        Logger.LogInformation($"Executing bash command from client: {command}");
        await BashProcess.StandardInput.WriteLineAsync(command);
        await BashProcess.StandardInput.FlushAsync();
    }

    // ponytail: CarStateUpdated + SendBashOutput target the browser UI, not the Onboard.
    // IControlClient (which the merged hub declares alongside the telemetry +
    // video subsets) still lists them, so the Onboard accepts the calls —
    // no-op is correct.
    public Task CarStateUpdated(CarStateModel state) => Task.CompletedTask;
    public Task SendBashOutput(int carId, string output, bool isError) => Task.CompletedTask;

    public async Task ConnectToServer()
    {
        if (!ServerConnectionService.IsConnected)
        {
            Logger.LogError("Cannot connect control: ServerConnectionService is not connected.");
            return;
        }
        _server = ServerConnectionService.GetProxy();
        var carId = CarConfigurationService.ServerAssignedCarId;
        if (!carId.HasValue)
        {
            Logger.LogError("Cannot connect to control server: ServerAssignedCarId not available");
            return;
        }
        await _server.RegisterForControl(carId.Value);
        Logger.LogInformation($"Connected to control server with CarId: {carId}");
        await TelemetryService.UpdateTelemetry("Control Server", "Connected");
    }

    public async Task TestControlsAsync() {
        await Control.RunControlTestsAsync();
    }
    
    public async Task<string?> AquireCarControl(SshAuthenticationRequest authRequest)
    {
        if (_sessionId != null && _lastControlUpdate.AddSeconds(30) > DateTime.Now) {
            Logger.LogError("Cannot aquire control: Already connected to driver session.");
            return null;
        }

        // Verify SSH signature
        if (SshKeyService.VerifySignature(authRequest.Challenge, authRequest.Signature))
        {
            // Generate a new session ID using ShortGuid (22 chars instead of 36)
            var newSessionId = ShortGuid.NewGuid().ToString();
            _sessionId = newSessionId;
            Logger.LogInformation($"Acquired control for car using SSH key. SessionID: {_sessionId}.");
            await TelemetryService.UpdateTelemetry("Control Session", "Connected (SSH)");
            return newSessionId; // Return the newly generated session ID
        }
        else
        {
            Logger.LogError("Cannot acquire control: Invalid SSH signature.");
            return null;
        }
    }

    public Task<string?> GetChallenge()
    {
        var challenge = SshKeyService.GenerateChallenge();
        return Task.FromResult(challenge);
    }

    public async Task ReleaseCarControl(string sessionId)
    {
        if (_sessionId != sessionId)
            return;
        Logger.LogInformation($"Release control for session {sessionId}");
        Control.ReleaseControl();
        await TelemetryService.UpdateTelemetry("Control Session", "Ended");
        _sessionId = null;
    }

    public Task UpdateChannel(string sessionId, string channelId, decimal value)
    {
        if (_sessionId != sessionId)
            return Task.CompletedTask;
        Logger.LogDebug($"Update channel {channelId} to {value}");
        Control.SetControl(channelId, value);
        _lastControlUpdate = DateTime.Now;
        return Task.CompletedTask;
    }

    public Task<long> Ping()
    {
        return Task.FromResult(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    public async Task OnClosed(Exception? exception)
    {
        Control.ReleaseControl();
        await TelemetryService.UpdateTelemetry("Control Server", "Disconnected");
    }

    public async Task OnReconnected(string? connectionId)
    {
        var carId = CarConfigurationService.ServerAssignedCarId;
        if (carId.HasValue)
        {
            await _server.RegisterForControl(carId.Value);
        }
        await TelemetryService.UpdateTelemetry("Control Server", "Connected");
    }

    public async Task OnReconnecting(Exception? exception)
    {
        Control.ReleaseControl();
        await TelemetryService.UpdateTelemetry("Control Server", "Disconnected");
    }

    private string FileTransferBasePath =>
        Configuration.GetValue<string>("FileTransfer:BasePath") ?? "/var/data/ltecar/files";

    public Task<bool> ApproveFileUpload(string sessionId, string filePath)
    {
        if (_sessionId != sessionId)
            return Task.FromResult(false);

        Logger.LogInformation("File upload approved: {FilePath}", filePath);
        return Task.FromResult(true);
    }

    public Task<ListFilesResponse> ListFiles(string sessionId, string path)
    {
        var response = new ListFilesResponse { Path = path };

        if (_sessionId != sessionId)
        {
            response.Error = "Invalid session";
            return Task.FromResult(response);
        }

        var fullPath = Path.GetFullPath(Path.Combine(FileTransferBasePath, path.TrimStart('/')));
        if (!fullPath.StartsWith(FileTransferBasePath))
        {
            response.Error = "Access denied";
            return Task.FromResult(response);
        }

        if (!Directory.Exists(fullPath))
        {
            response.Error = "Directory not found";
            return Task.FromResult(response);
        }

        foreach (var dir in Directory.GetDirectories(fullPath))
        {
            var info = new DirectoryInfo(dir);
            response.Entries.Add(new FileListEntry
            {
                Name = info.Name,
                FullPath = Path.GetRelativePath(FileTransferBasePath, dir),
                IsDirectory = true,
                LastModifiedUtc = info.LastWriteTimeUtc
            });
        }

        foreach (var file in Directory.GetFiles(fullPath))
        {
            var info = new FileInfo(file);
            response.Entries.Add(new FileListEntry
            {
                Name = info.Name,
                FullPath = Path.GetRelativePath(FileTransferBasePath, file),
                IsDirectory = false,
                SizeBytes = info.Length,
                LastModifiedUtc = info.LastWriteTimeUtc
            });
        }

        return Task.FromResult(response);
    }

    public Task<bool> DeleteFile(string sessionId, string filePath)
    {
        if (_sessionId != sessionId)
            return Task.FromResult(false);

        var fullPath = Path.GetFullPath(Path.Combine(FileTransferBasePath, filePath.TrimStart('/')));
        if (!fullPath.StartsWith(FileTransferBasePath))
            return Task.FromResult(false);

        if (File.Exists(fullPath))
        {
            File.Delete(fullPath);
            Logger.LogInformation("File deleted: {FilePath}", fullPath);
            return Task.FromResult(true);
        }

        if (Directory.Exists(fullPath))
        {
            Directory.Delete(fullPath, recursive: true);
            Logger.LogInformation("Directory deleted: {FilePath}", fullPath);
            return Task.FromResult(true);
        }

        return Task.FromResult(false);
    }

    public async Task FileReady(FileReadyNotification notification)
    {
        Logger.LogInformation("FileReady: token {Token}, file '{FileName}', {Size} bytes",
            notification.Token, notification.FileName, notification.FileSizeBytes);
        // TODO: download from /api/filetransfer/{token}/download, save to FileTransferBasePath, report status
        await Task.CompletedTask;
    }

    // ponytail: server pushes per-channel updates; we apply them locally so the next
    // SyncChannelMap carries them back. LWW already happens in the hub's SyncChannelMap,
    // so we trust the server's value (ModifiedAt stamp already set by controller).
    public async Task UpsertControlChannel(string dictKey, ControlChannelMapItem item)
    {
        if (string.IsNullOrEmpty(dictKey) || item == null) return;
        ChannelMap.ControlChannels[dictKey] = item;
        await ChannelStore.UpsertControlChannelAsync(dictKey, item);
        Logger.LogInformation("UpsertControlChannel {Key}", dictKey);
    }

    public async Task DeleteControlChannel(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.ControlChannels.Remove(dictKey))
        {
            await ChannelStore.DeleteControlChannelAsync(dictKey);
            Logger.LogInformation("DeleteControlChannel {Key}", dictKey);
        }
    }

    public async Task UpsertTelemetryChannel(string dictKey, TelemetryChannelMapItem item)
    {
        if (string.IsNullOrEmpty(dictKey) || item == null) return;
        ChannelMap.TelemetryChannels[dictKey] = item;
        await ChannelStore.UpsertTelemetryChannelAsync(dictKey, item);
        Logger.LogInformation("UpsertTelemetryChannel {Key}", dictKey);
    }

    public async Task DeleteTelemetryChannel(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.TelemetryChannels.Remove(dictKey))
        {
            await ChannelStore.DeleteTelemetryChannelAsync(dictKey);
            Logger.LogInformation("DeleteTelemetryChannel {Key}", dictKey);
        }
    }

    public async Task UpsertVideoStream(string dictKey, VideoStreamMapItem item)
    {
        if (string.IsNullOrEmpty(dictKey) || item == null) return;
        ChannelMap.VideoStreams[dictKey] = item;
        await ChannelStore.UpsertVideoStreamAsync(dictKey, item);
        Logger.LogInformation("UpsertVideoStream {Key}", dictKey);
    }

    public async Task DeleteVideoStream(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.VideoStreams.Remove(dictKey))
        {
            await ChannelStore.DeleteVideoStreamAsync(dictKey);
            Logger.LogInformation("DeleteVideoStream {Key}", dictKey);
        }
    }

    /// <summary>
    /// Server-pushed channel map (SPOT). Replace the local in-memory and persisted config entirely.
    /// </summary>
    public async Task ApplyChannelMap(ChannelMap channelMap, string channelMapHash)
    {
        if (channelMap == null) return;

        ChannelMap.PinManagers.Clear();
        foreach (var kv in channelMap?.PinManagers ?? new Dictionary<string, PinManagerMapItem>())
            ChannelMap.PinManagers[kv.Key] = kv.Value;

        ChannelMap.ControlChannels.Clear();
        foreach (var kv in channelMap?.ControlChannels ?? new Dictionary<string, ControlChannelMapItem>())
            ChannelMap.ControlChannels[kv.Key] = kv.Value;

        ChannelMap.TelemetryChannels.Clear();
        foreach (var kv in channelMap?.TelemetryChannels ?? new Dictionary<string, TelemetryChannelMapItem>())
            ChannelMap.TelemetryChannels[kv.Key] = kv.Value;

        ChannelMap.VideoStreams.Clear();
        foreach (var kv in channelMap?.VideoStreams ?? new Dictionary<string, VideoStreamMapItem>())
            ChannelMap.VideoStreams[kv.Key] = kv.Value;

        await ChannelStore.ReplaceAllAsync(ChannelMap);

        Logger.LogInformation("Applied server-pushed channel map (hash {Hash}) with {Control} control, {Telemetry} telemetry, {Video} video streams, {Pin} pin managers",
            channelMapHash,
            ChannelMap.ControlChannels.Count,
            ChannelMap.TelemetryChannels.Count,
            ChannelMap.VideoStreams.Count,
            ChannelMap.PinManagers.Count);
    }
}