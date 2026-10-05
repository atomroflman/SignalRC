using System.Net.Http.Json;
using System.Text.Json;
using LteCar.Onboard.Control;
using LteCar.Onboard.Services;
using LteCar.Onboard.Telemetry;
using LteCar.Onboard.Video;
using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TypedSignalR.Client;

namespace LteCar.Onboard;

public class ServerConnectionService
{
    // Initialization sequence (new handshake):
    // 1. Establish SignalR hub connection.
    // 2. Call SyncChannelMapAsync (preferred) to push full ChannelMap & receive numeric ID mapping + hash.
    // 3. Call OpenCarConnection using the server-provided hash to avoid redundant UpdateChannelMap traffic.
    // 4. If server indicates mismatch (legacy cases or server side reset) we trigger a fresh SyncChannelMap.
    // Persisted artifacts: channelMap.server.json (server-normalized map + ids) & channelMap.hash.
    public IServiceProvider ServiceProvider { get; }
    public ILogger<ServerConnectionService> Logger { get; }

    private readonly ChannelMap _channelMap;
    private readonly IConfiguration _configuration;
    private readonly IOnboardBuildInfoService _buildInfo;
    private readonly AvailableChannelTypesService _availableTypes;
    private readonly HttpClient _http;
    private HubConnection _connection = null!;
    private ChannelMapSyncResponse? _lastSync;
    private int? _serverAssignedCarId;
    private string? _carIdentityKey;

    public bool IsConnected => _connection?.State == HubConnectionState.Connected;

    public HubConnection Connection =>
        _connection ?? throw new InvalidOperationException("Connection not established yet.");

    public IConnectionHubServer GetProxy()
    {
        if (_connection == null)
            throw new InvalidOperationException("Connection not established yet.");
        return _connection.CreateHubProxy<IConnectionHubServer>();
    }

    public ServerConnectionService(
        ChannelMap channelMap,
        IConfiguration configuration,
        IServiceProvider serviceProvider,
        ILogger<ServerConnectionService> logger,
        IOnboardBuildInfoService buildInfo,
        AvailableChannelTypesService availableTypes)
    {
        ServiceProvider = serviceProvider;
        Logger = logger;
        _channelMap = channelMap;
        _configuration = configuration;
        _buildInfo = buildInfo;
        _availableTypes = availableTypes;
        _http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
    }

    public UriBuilder GetServerUriBuilder() 
    {
        var serverAddressBuilder = new UriBuilder();
        serverAddressBuilder.Host = _configuration.GetValue<string>("ServerName");
        serverAddressBuilder.Scheme = (_configuration.GetValue<bool?>("UseHttps") ?? true) ? "https" : "http";
        serverAddressBuilder.Port = _configuration.GetValue<int?>("ServerPort") ?? 5000;
        return serverAddressBuilder;
    }

    public HubConnection ConnectToHub(string name) 
    {
        var serverUriBuilder = GetServerUriBuilder();
        serverUriBuilder.Path = name;
        var connectionHubEndpoint = serverUriBuilder.Uri;
        Logger.LogInformation($"Connecting to server: {connectionHubEndpoint}");
        return new HubConnectionBuilder()
            .WithUrl(connectionHubEndpoint)
            .WithAutomaticReconnect(Enumerable.Range(0, 50).Select(e => TimeSpan.FromMilliseconds(Math.Pow(1.25d, e) * 1000)).ToArray())
            .AddMessagePackProtocol()
            .Build();
    }
    
    public async Task ConnectToServer(string carIdentityKey)
    {
        _carIdentityKey = carIdentityKey;
        _connection = ConnectToHub(HubPaths.CarConnectionHub);
        _connection.Reconnected += OnReconnectedAsync;
        _connection.Reconnecting += (connectionId) =>
        {
            Logger.LogWarning($"Reconnecting to server with connection ID: {connectionId}");
            return Task.CompletedTask;
        };
        _connection.Closed += (error) =>
        {
            Logger.LogError($"Connection closed: {error}");
            return Task.CompletedTask;
        };
        await _connection.StartAsync();

        // Register each Onboard service under its own narrow SignalR-client
        // interface so the merged hub can push the matching subset of calls
        // back to us over this one connection. The hub is typed
        // Hub<IControlClient, ITelemetryClient, ICarVideoClient>; SignalR
        // matches handlers by method name, so each service is reachable via
        // its declared subset.
        var controlService = ServiceProvider.GetRequiredService<ControlService>();
        _connection.Register<IControlClient>(controlService);
        var telemetryService = ServiceProvider.GetRequiredService<TelemetryService>();
        _connection.Register<ITelemetryClient>(telemetryService);
        var videoStreamService = ServiceProvider.GetRequiredService<VideoStreamService>();
        _connection.Register<ICarVideoClient>(videoStreamService);
        var diagnosticsService = ServiceProvider.GetRequiredService<OnboardDiagnosticsService>();
        _connection.Register<IDiagnosticsClient>(diagnosticsService);

        Logger.LogInformation($"Connected to server: {_connection.State}");
        await _connection.InvokeAsync("Test");
        Logger.LogDebug($"Tested... Open connection with carIdentityKey: {carIdentityKey}");

        await CheckServerVersionAsync();
        await PerformServerHandshakeAsync();
    }

    private async Task OnReconnectedAsync(string? connectionId)
    {
        Logger.LogInformation($"Connection {connectionId} reestablished.");
        await PerformServerHandshakeAsync();
    }

    private async Task PerformServerHandshakeAsync()
    {
        if (_connection == null || string.IsNullOrEmpty(_carIdentityKey))
        {
            Logger.LogWarning("Cannot perform server handshake: connection or identity key missing.");
            return;
        }

        try
        {
            var connectionServer = _connection.CreateHubProxy<IConnectionHubServer>();
            Logger.LogDebug("Proxy created...");

            // Prefer hash from last SyncChannelMap (if sync already performed before OpenCarConnection is called)
            var channelMapHash = _lastSync?.Hash ?? ChannelMapHashProvider.GenerateHash(_channelMap);
            var config = await connectionServer.OpenCarConnection(_carIdentityKey, channelMapHash);
            if (config == null)
            {
                Logger.LogError("Failed to open car connection.");
                return;
            }

            // Store server-assigned CarId for all future operations
            _serverAssignedCarId = config.ServerAssignedCarId;
            Logger.LogInformation($"Server assigned CarId: {_serverAssignedCarId}");

            // SPOT handshake: the server is the sole source of truth. OpenCarConnection
            // returns the current server map when the client is out of date or when the
            // server has no config (empty map). Apply it to the local store.
            if (config.ChannelMap != null)
            {
                var controlService = ServiceProvider.GetRequiredService<ControlService>();
                await controlService.ApplyChannelMap(config.ChannelMap, config.ChannelMapHash);
                Logger.LogInformation("Applied server channel map from OpenCarConnection (hash {Hash}).", config.ChannelMapHash);
            }

            Logger.LogDebug($"OpenCarConnection called: {JsonSerializer.Serialize(config)}");
            var configService = ServiceProvider.GetRequiredService<ServerCarConfigurationService>();
            configService.UpdateConfiguration(config);

            var buildInfo = _buildInfo.GetBuildInfo();
            try
            {
                await connectionServer.ReportOnboardVersion(buildInfo.Branch, buildInfo.Commit);
            }
            catch (Exception ex)
            {
                Logger.LogWarning(ex, "Failed to report onboard version to server");
            }

            await RegisterAvailableTypesAsync();
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to perform server handshake.");
        }
    }

    private async Task RegisterAvailableTypesAsync()
    {
        if (_connection == null || !_serverAssignedCarId.HasValue) return;
        try
        {
            var proxy = _connection.CreateHubProxy<IConnectionHubServer>();
            await proxy.RegisterAvailableChannelTypes(_serverAssignedCarId.Value, _availableTypes.GetAvailableTypes());
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to register available channel types with server");
        }
    }

    public async Task<ChannelMapSyncResponse?> SyncChannelMapAsync()
    {
        if (_connection == null)
        {
            Logger.LogError("Cannot sync channel map. Connection not established.");
            return null;
        }
        if (!_serverAssignedCarId.HasValue)
        {
            Logger.LogError("Cannot sync channel map. Server-assigned CarId not available. Call ConnectToServer first.");
            return null;
        }
        var proxy = _connection.CreateHubProxy<IConnectionHubServer>();
        var request = new ChannelMapSyncRequest { CarId = _serverAssignedCarId.Value, ChannelMap = _channelMap };
        Logger.LogInformation("Sending ChannelMapSyncRequest for CarId {CarId} with local hash {LocalHash}",
            _serverAssignedCarId.Value, ChannelMapHashProvider.GenerateHash(_channelMap));
        
        var response = await proxy.SyncChannelMap(request);
        _lastSync = response;

        // SPOT: apply the server-pushed configuration to the local in-memory and persisted store.
        try
        {
            var controlService = ServiceProvider.GetRequiredService<ControlService>();
            await controlService.ApplyChannelMap(response.ChannelMap, response.Hash);
            Logger.LogInformation("Applied server channel map after sync. Hash {Hash}", response.Hash);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to apply server channel map after sync");
        }

        try
        {
            await File.WriteAllTextAsync("channelMap.server.json", JsonSerializer.Serialize(response, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to persist channel map sync response");
        }
        Logger.LogInformation("Channel map synced. Hash {Hash}", response.Hash);
        return response;
    }

    public bool TryLoadPreviousSync()
    {
        try
        {
            if (!File.Exists("channelMap.server.json")) return false;
            var json = File.ReadAllText("channelMap.server.json");
            var stored = JsonSerializer.Deserialize<ChannelMapSyncResponse>(json);
            if (stored == null || stored.ChannelMap == null) return false;
            // Copy serverIds into current in-memory map if matching keys exist
            foreach (var kv in stored.ChannelMap.ControlChannels)
            {
                if (_channelMap.ControlChannels.TryGetValue(kv.Key, out var current))
                {
                    current.ServerId = kv.Value.ServerId;
                }
            }
            foreach (var kv in stored.ChannelMap.TelemetryChannels)
            {
                if (_channelMap.TelemetryChannels.TryGetValue(kv.Key, out var current))
                {
                    current.ServerId = kv.Value.ServerId;
                }
            }
            foreach (var kv in stored.ChannelMap.VideoStreams)
            {
                if (_channelMap.VideoStreams.TryGetValue(kv.Key, out var current))
                {
                    current.ServerId = kv.Value.ServerId;
                }
            }
            _lastSync = stored;
            Logger.LogInformation("Loaded previous channel map sync with hash {Hash}", stored.Hash);
            return true;
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to load previous channel map sync");
            return false;
        }
    }

    // ponytail: fetches /api/version once on connect and warns on branch/commit mismatch.
    // Single-shot, fire-and-log: we don't retry on transient failures and we don't act
    // (auto-update would need a separate opt-in flag — out of scope here).
    private async Task CheckServerVersionAsync()
    {
        try
        {
            var builder = GetServerUriBuilder();
            builder.Path = "/api/version";
            var url = builder.Uri.ToString();

            var remote = await _http.GetFromJsonAsync<ServerVersionDto>(url);
            if (remote is null)
            {
                Logger.LogWarning("Server version endpoint returned empty body ({Url})", url);
                return;
            }

            var local = _buildInfo.GetBuildInfo();
            var shortLocal = ShortenCommit(local.Commit);
            var shortRemote = ShortenCommit(remote.Commit);

            Logger.LogInformation("Version: local {LocalBranch}@{LocalCommit} | server {RemoteBranch}@{RemoteCommit}",
                local.Branch, shortLocal, remote.Branch ?? "?", shortRemote);

            var branchMismatch = !string.Equals(local.Branch, remote.Branch, StringComparison.OrdinalIgnoreCase);
            var commitMismatch = local.Commit is not null && remote.Commit is not null
                && !string.Equals(local.Commit, remote.Commit, StringComparison.OrdinalIgnoreCase);

            if (branchMismatch || commitMismatch)
            {
                Logger.LogWarning(
                    "Version mismatch with server. Local={LocalBranch}@{LocalCommit}, Server={RemoteBranch}@{RemoteCommit}. Run 'dotnet run -- update' to sync.",
                    local.Branch, shortLocal, remote.Branch ?? "?", shortRemote);
            }
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to check server version");
        }
    }

    private static string ShortenCommit(string? commit) =>
        string.IsNullOrEmpty(commit) || commit.Length < 8 ? commit ?? "?" : commit[..8];

    private sealed record ServerVersionDto(string? Branch, string? Commit);
}