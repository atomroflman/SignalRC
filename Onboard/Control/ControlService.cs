using CSharpVitamins;
using SignalRC.Onboard.Data;
using SignalRC.Onboard.Flow;
using SignalRC.Onboard.Input;
using SignalRC.Shared.Flow;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Services;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared;
using SignalRC.Shared.Channels;
using SignalRC.Shared.FileTransfer;
using SignalRC.Server.Hubs;
using SignalRC.Shared.HubClients;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TypedSignalR.Client;
using SignalRC.Onboard;
using System.Diagnostics;
using System.Text.Json;

namespace SignalRC.Onboard.Control;

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
    public IMediaMtxConfigurator MediaMtx { get; }
    public ChannelHealthService Health { get; }
    public Process BashProcess { get; } = new Process();
    public OnboardFlowService Flow { get; }
    public BluetoothService BluetoothService { get; }

    private string? _sessionId;
    private DateTime _lastControlUpdate = DateTime.Now;

    /// <summary>
    /// Raised whenever the control session is replaced or released. Session-bound
    /// resources (microphone uplink, speaker playback) must be torn down.
    /// </summary>
    public event Action? SessionChanged;

    public bool IsActiveSession(string? sessionId) => _sessionId != null && _sessionId == sessionId;

    /// <summary>
    /// A driver holds the session and was active recently, by the same rule that keeps
    /// another driver from taking it over. The automatic update waits while this is true.
    /// </summary>
    public bool HasLiveSession => _sessionId != null && _lastControlUpdate.AddSeconds(30) > DateTime.Now;

    // Set while a self-update installs and restarts: controls stay neutral, no new session.
    private volatile bool _lockedForUpdate;

    public bool IsLockedForUpdate => _lockedForUpdate;

    /// <summary>Puts all controls to neutral and ignores further control input until the restart.</summary>
    public void LockForUpdate()
    {
        _lockedForUpdate = true;
        Flow.Pause(true);
        Control.ReleaseControl();
        Logger.LogWarning("Controls locked for the onboard update.");
    }

    /// <summary>The update failed before switching releases: controls work again, the driver has to take over anew.</summary>
    public async Task UnlockAfterFailedUpdateAsync()
    {
        _lockedForUpdate = false;
        Flow.Pause(false);
        if (_sessionId != null)
            await ReleaseCarControl(_sessionId);
        Logger.LogWarning("Controls unlocked after the failed onboard update.");
    }

    /// <summary>
    /// Counts non-channel activity (e.g. push-to-talk) as driver activity so the
    /// session isn't considered idle and taken over while the driver is talking.
    /// </summary>
    public void MarkSessionActivity() => _lastControlUpdate = DateTime.Now;
    private IConnectionHubServer _server = null!;

    public ControlService(ILogger<ControlService> logger, TelemetryService telemetryService, ControlExecutionService control, IServiceProvider serviceProvider, IConfiguration configuration, ServerConnectionService serverConnectionService, SshKeyService sshKeyService, ServerCarConfigurationService carConfigurationService, OnboardChannelStore channelStore, ChannelMap channelMap, IMediaMtxConfigurator mediaMtx, ChannelHealthService health, OnboardFlowService flow, BluetoothService bluetooth, VehicleInputService vehicleInputs)
    {
        Health = health;
        Flow = flow;
        BluetoothService = bluetooth;
        // Someone driving with the local controller keeps the session alive (T10).
        vehicleInputs.Activity += () => { if (_sessionId != null) MarkSessionActivity(); };
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
        MediaMtx = mediaMtx;
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
        Flow.OnServerConnected();
        Logger.LogInformation($"Connected to control server with CarId: {carId}");
        await TelemetryService.UpdateTelemetry("Control Server", "Connected");
    }

    public async Task TestControlsAsync() {
        await Control.RunControlTestsAsync();
    }
    
    public async Task<string?> AquireCarControl(SshAuthenticationRequest authRequest)
    {
        if (_lockedForUpdate) {
            Logger.LogError("Cannot aquire control: the onboard is updating.");
            return null;
        }
        if (_sessionId != null && _lastControlUpdate.AddSeconds(30) > DateTime.Now) {
            Logger.LogError("Cannot aquire control: Already connected to driver session.");
            return null;
        }

        // The challenge must be one this onboard issued and not used yet (no replay).
        if (!SshKeyService.TryConsumeChallenge(authRequest.Challenge))
        {
            Logger.LogError("Cannot acquire control: unknown, expired or reused challenge.");
            return null;
        }

        // Verify SSH signature
        if (SshKeyService.VerifySignature(authRequest.Challenge, authRequest.Signature))
        {
            // Generate a new session ID using ShortGuid (22 chars instead of 36)
            var newSessionId = ShortGuid.NewGuid().ToString();
            // The previous driver's onboard flow ends with their session; the server pushes the new one (E04).
            Flow.Clear();
            _sessionId = newSessionId;
            SessionChanged?.Invoke();
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
        Flow.Clear();
        Control.ReleaseControl();
        await TelemetryService.UpdateTelemetry("Control Session", "Ended");
        _sessionId = null;
        SessionChanged?.Invoke();
    }

    public Task UpdateChannel(string sessionId, string channelId, decimal value)
    {
        if (_sessionId != sessionId || _lockedForUpdate)
            return Task.CompletedTask;
        // Never mixed (E03): channels of the onboard flow, and everything while detached, ignore the browser.
        if (Flow.WebDetached || Flow.OwnsChannel(channelId))
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
        ReleaseBrowserChannels();
        await TelemetryService.UpdateTelemetry("Control Server", "Disconnected");
    }

    public async Task OnReconnected(string? connectionId)
    {
        var carId = CarConfigurationService.ServerAssignedCarId;
        if (carId.HasValue)
        {
            await _server.RegisterForControl(carId.Value);
        }
        Flow.OnServerConnected();
        await TelemetryService.UpdateTelemetry("Control Server", "Connected");
    }

    public async Task OnReconnecting(Exception? exception)
    {
        ReleaseBrowserChannels();
        await TelemetryService.UpdateTelemetry("Control Server", "Disconnected");
    }

    /// <summary>
    /// Server lost (T09): handoffs disconnect, browser channels go neutral unless the web is
    /// detached, the onboard flow keeps running.
    /// </summary>
    private void ReleaseBrowserChannels()
    {
        Flow.OnServerLost();
        if (!Flow.WebDetached)
            Control.ReleaseControl(c => !Flow.OwnsChannel(c));
    }

    // -- Onboard flow (OnboardFlow-Arbeitspakete.md OF06) --------------------------------

    public Task ApplyOnboardFlow(string sessionId, OnboardFlowDefinition? flow)
    {
        if (_sessionId != sessionId)
        {
            Logger.LogWarning("Onboard flow ignored: not the current control session.");
            return Task.CompletedTask;
        }
        Flow.Apply(flow);
        return Task.CompletedTask;
    }

    public Task UpdateFlowHandoff(string sessionId, int nodeId, decimal value)
    {
        if (_sessionId != sessionId || _lockedForUpdate)
            return Task.CompletedTask;
        Flow.SetHandoff(nodeId, (double)value);
        _lastControlUpdate = DateTime.Now;
        return Task.CompletedTask;
    }

    public Task<bool> SetWebDetached(string sessionId, bool detached)
    {
        if (_sessionId != sessionId || _lockedForUpdate)
            return Task.FromResult(Flow.WebDetached);
        _lastControlUpdate = DateTime.Now;
        return Task.FromResult(Flow.SetWebDetached(detached));
    }

    public async Task<BluetoothResult> Bluetooth(string sessionId, string action, string? address)
    {
        if (_sessionId != sessionId)
            return new BluetoothResult { Success = false, Message = "Invalid session" };
        return await BluetoothService.ExecuteAsync(action, address);
    }

    private string FileTransferBasePath =>
        Configuration.GetValue<string>("FileTransfer:BasePath") ?? "/var/data/signalrc/files";

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
        item.Options = ChannelOptions.Normalize(item.Options);
        ChannelMap.ControlChannels[dictKey] = item;
        await ChannelStore.UpsertControlChannelAsync(dictKey, item);
        Logger.LogInformation("UpsertControlChannel {Key}", dictKey);
        Control.Reload(dictKey);
    }

    public async Task DeleteControlChannel(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.ControlChannels.Remove(dictKey))
        {
            await ChannelStore.DeleteControlChannelAsync(dictKey);
            Logger.LogInformation("DeleteControlChannel {Key}", dictKey);
            Control.Reload(dictKey);
        }
    }

    public async Task UpsertTelemetryChannel(string dictKey, TelemetryChannelMapItem item)
    {
        if (string.IsNullOrEmpty(dictKey) || item == null) return;
        item.Options = ChannelOptions.Normalize(item.Options);
        ChannelMap.TelemetryChannels[dictKey] = item;
        await ChannelStore.UpsertTelemetryChannelAsync(dictKey, item);
        Logger.LogInformation("UpsertTelemetryChannel {Key}", dictKey);
        TelemetryService.RequestReload(dictKey);
    }

    public async Task DeleteTelemetryChannel(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.TelemetryChannels.Remove(dictKey))
        {
            await ChannelStore.DeleteTelemetryChannelAsync(dictKey);
            Logger.LogInformation("DeleteTelemetryChannel {Key}", dictKey);
            TelemetryService.RequestReload(dictKey);
        }
    }

    public async Task UpsertVideoStream(string dictKey, VideoStreamMapItem item)
    {
        if (string.IsNullOrEmpty(dictKey) || item == null) return;
        item.Options = ChannelOptions.Normalize(item.Options);
        ChannelMap.VideoStreams[dictKey] = item;
        await ChannelStore.UpsertVideoStreamAsync(dictKey, item);
        Logger.LogInformation("UpsertVideoStream {Key}", dictKey);
        await RegenerateVideoAsync();
    }

    public async Task DeleteVideoStream(string dictKey)
    {
        if (string.IsNullOrEmpty(dictKey)) return;
        if (ChannelMap.VideoStreams.Remove(dictKey))
        {
            await ChannelStore.DeleteVideoStreamAsync(dictKey);
            Logger.LogInformation("DeleteVideoStream {Key}", dictKey);
            Health.Ok(ChannelTypeSchema.Video, dictKey);
            await RegenerateVideoAsync();
        }
    }

    /// <summary>
    /// Server-pushed channel map (SPOT). Replace the local in-memory and persisted config entirely.
    /// </summary>
    public async Task ApplyChannelMap(ChannelMap channelMap, string channelMapHash)
    {
        if (channelMap == null) return;
        ChannelOptions.Normalize(channelMap);

        // Only what changed is rebuilt: OpenCarConnection both returns and pushes the
        // map, and an unchanged channel must not be released while it is driven.
        var changedPinManagers = Changed(ChannelMap.PinManagers, channelMap.PinManagers ?? new());
        var changedControls = Changed(ChannelMap.ControlChannels, channelMap.ControlChannels ?? new());
        var changedTelemetry = Changed(ChannelMap.TelemetryChannels, channelMap.TelemetryChannels ?? new());
        foreach (var gone in ChannelMap.VideoStreams.Keys.Except(channelMap.VideoStreams?.Keys ?? Enumerable.Empty<string>()).ToList())
            Health.Ok(ChannelTypeSchema.Video, gone);

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

        if (changedPinManagers.Count > 0)
        {
            // Controls and readers hold their pin manager: release all of them, replace
            // the changed managers, then build everything against the new ones.
            var factory = ServiceProvider.GetRequiredService<IModuleManagerFactory>();
            Control.ReloadAll(() =>
            {
                foreach (var name in changedPinManagers)
                {
                    factory.Invalidate(name);
                    Health.Ok(ChannelTypeSchema.PinManager, name);
                }
                TelemetryService.RequestReloadAll();
            });
        }
        else
        {
            foreach (var name in changedControls)
                Control.Reload(name);
            foreach (var name in changedTelemetry)
                TelemetryService.RequestReload(name);
        }
        await RegenerateVideoAsync();

        Logger.LogInformation("Applied server-pushed channel map (hash {Hash}) with {Control} control, {Telemetry} telemetry, {Video} video streams, {Pin} pin managers",
            channelMapHash,
            ChannelMap.ControlChannels.Count,
            ChannelMap.TelemetryChannels.Count,
            ChannelMap.VideoStreams.Count,
            ChannelMap.PinManagers.Count);
    }

    /// <summary>Keys added, removed or changed between the current and the pushed map.</summary>
    private static List<string> Changed<T>(IReadOnlyDictionary<string, T> current, IReadOnlyDictionary<string, T> next)
    {
        return current.Keys.Union(next.Keys)
            .Where(key => !current.TryGetValue(key, out var a) || !next.TryGetValue(key, out var b)
                || JsonSerializer.Serialize(a) != JsonSerializer.Serialize(b))
            .ToList();
    }

    /// <summary>
    /// Rewrites the MediaMTX config. A failure is reported on every stream, since the
    /// config is written for all of them at once.
    /// </summary>
    private async Task RegenerateVideoAsync()
    {
        try
        {
            await MediaMtx.GenerateFromChannelMapAsync(ChannelMap);
            foreach (var key in ChannelMap.VideoStreams.Keys.ToList())
                Health.Ok(ChannelTypeSchema.Video, key);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Writing the MediaMTX config failed.");
            foreach (var key in ChannelMap.VideoStreams.Keys.ToList())
                Health.Error(ChannelTypeSchema.Video, key, $"MediaMTX config: {ChannelHealthService.Describe(ex)}");
        }
    }
}