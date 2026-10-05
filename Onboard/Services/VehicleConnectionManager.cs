using System.Text.Json;
using LteCar.Onboard.Services;
using LteCar.Shared.Channels;
using LteCar.Shared.Hubs;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using TypedSignalR.Client;

namespace LteCar.Onboard;

public interface IVehicleService
{
    string ServiceName { get; }
    Task InitializeAsync();
    Task OnConnectedAsync(HubConnection connection);
    Task OnReconnectedAsync(HubConnection connection, string? connectionId);
    Task OnReconnectingAsync(HubConnection connection, Exception? exception);
}

public abstract class VehicleServiceBase : IVehicleService
{
    public abstract string ServiceName { get; }
    public virtual Task InitializeAsync() => Task.CompletedTask;
    public virtual Task OnConnectedAsync(HubConnection connection) => Task.CompletedTask;
    public virtual Task OnReconnectedAsync(HubConnection connection, string? connectionId) => Task.CompletedTask;
    public virtual Task OnReconnectingAsync(HubConnection connection, Exception? exception) => Task.CompletedTask;
}

public interface IVehicleConnectionManager
{
    HubConnection Connection { get; }
    int? ServerAssignedCarId { get; }
    bool IsConnected { get; }
    event EventHandler<HubConnectionState>? ConnectionStateChanged;
    event EventHandler<string>? CarIdAssigned;
    
    Task ConnectAsync(string carIdentityKey);
    Task<ChannelMapSyncResponse?> SyncChannelMapAsync();
    Task NotifyAsync(string method, object? arg);
    Task<T?> InvokeAsync<T>(string method, CancellationToken cancellationToken = default, params object?[] args);
    IReadOnlyList<IVehicleService> GetDiscoveredServices();
}

public class VehicleConnectionManager : IVehicleConnectionManager, IDisposable
{
    private readonly ChannelMap _channelMap;
    private readonly IConfiguration _configuration;
    private readonly ILogger<VehicleConnectionManager> _logger;
    private readonly IServiceProvider _serviceProvider;
    private readonly IOnboardBuildInfoService _buildInfo;
    private readonly List<IVehicleService> _discoveredServices = new();
    private HubConnection _connection;
    private ChannelMapSyncResponse? _lastSync;
    
    public HubConnection Connection => _connection;
    public int? ServerAssignedCarId { get; private set; }
    public bool IsConnected => _connection.State == HubConnectionState.Connected;
    
    public event EventHandler<HubConnectionState>? ConnectionStateChanged;
    public event EventHandler<string>? CarIdAssigned;

    public VehicleConnectionManager(
        ChannelMap channelMap,
        IConfiguration configuration,
        ILogger<VehicleConnectionManager> logger,
        IServiceProvider serviceProvider,
        IOnboardBuildInfoService buildInfo)
    {
        _channelMap = channelMap;
        _configuration = configuration;
        _logger = logger;
        _serviceProvider = serviceProvider;
        _buildInfo = buildInfo;

        _connection = CreateHubConnection();
        SetupConnectionHandlers();
        DiscoverServices();
    }

    private HubConnection CreateHubConnection()
    {
        var serverUriBuilder = GetServerUriBuilder();
        serverUriBuilder.Path = HubPaths.CarConnectionHub;
        var connectionHubEndpoint = serverUriBuilder.Uri;
        _logger.LogInformation("Creating connection to: {Endpoint}", connectionHubEndpoint);
        
        return new HubConnectionBuilder()
            .WithUrl(connectionHubEndpoint)
            .WithAutomaticReconnect(Enumerable.Range(0, 50).Select(e => TimeSpan.FromMilliseconds(Math.Pow(1.25d, e) * 1000)).ToArray())
            .AddMessagePackProtocol()
            .Build();
    }

    private void SetupConnectionHandlers()
    {
        _connection.Closed += async (error) =>
        {
            _logger.LogError(error, "Connection closed");
            ConnectionStateChanged?.Invoke(this, HubConnectionState.Disconnected);
        };
        
        _connection.Reconnecting += (connectionId) =>
        {
            _logger.LogWarning("Reconnecting to server. Connection ID: {ConnectionId}", connectionId);
            ConnectionStateChanged?.Invoke(this, HubConnectionState.Reconnecting);
            return Task.CompletedTask;
        };
        
        _connection.Reconnected += async (connectionId) =>
        {
            _logger.LogInformation("Reconnected with ID: {ConnectionId}", connectionId);
            ConnectionStateChanged?.Invoke(this, HubConnectionState.Connected);
            ServerAssignedCarId = await ReRegisterCarAsync();
            foreach (var service in _discoveredServices)
            {
                try
                {
                    await service.OnReconnectedAsync(_connection, connectionId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error in {Service} OnReconnected", service.ServiceName);
                }
            }
        };
    }

    private void DiscoverServices()
    {
        _logger.LogInformation("Discovering vehicle services...");
        
        var serviceTypes = typeof(VehicleConnectionManager).Assembly.GetTypes()
            .Where(t => typeof(IVehicleService).IsAssignableFrom(t) && !t.IsInterface && !t.IsAbstract);
        
        foreach (var type in serviceTypes)
        {
            try
            {
                var service = _serviceProvider.GetRequiredService(type) as IVehicleService;
                if (service != null)
                {
                    _discoveredServices.Add(service);
                    _logger.LogInformation("Discovered service: {ServiceName}", service.ServiceName);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not instantiate service {Type}", type.Name);
            }
        }
        
        _logger.LogInformation("Service discovery complete. Found {Count} services", _discoveredServices.Count);
    }

    public IReadOnlyList<IVehicleService> GetDiscoveredServices() => _discoveredServices.AsReadOnly();

    private UriBuilder GetServerUriBuilder()
    {
        var serverAddressBuilder = new UriBuilder();
        serverAddressBuilder.Host = _configuration.GetValue<string>("ServerName") ?? "localhost";
        serverAddressBuilder.Scheme = (_configuration.GetValue<bool?>("UseHttps") ?? true) ? "https" : "http";
        serverAddressBuilder.Port = _configuration.GetValue<int?>("ServerPort") ?? 5000;
        return serverAddressBuilder;
    }

    public async Task ConnectAsync(string carIdentityKey)
    {
        _logger.LogInformation("Connecting to server as car: {CarIdentityKey}", carIdentityKey);
        
        await _connection.StartAsync();
        _logger.LogDebug("Connection started, state: {State}", _connection.State);
        
        var connectionServer = _connection.CreateHubProxy<IConnectionHubServer>();
        
        var channelMapHash = _lastSync?.Hash ?? ChannelMapHashProvider.GenerateHash(_channelMap);
        var config = await connectionServer.OpenCarConnection(carIdentityKey, channelMapHash);
        
        if (config == null)
        {
            _logger.LogError("Failed to open car connection - server returned null");
            throw new InvalidOperationException("Failed to connect to server");
        }
        
        ServerAssignedCarId = config.ServerAssignedCarId;
        CarIdAssigned?.Invoke(this, ServerAssignedCarId.Value.ToString());
        _logger.LogInformation("Server assigned CarId: {CarId}", ServerAssignedCarId);
        
        if (config.ChannelMap != null)
        {
            _logger.LogInformation("Server pushed a channel map (hash {Hash}). Applying locally.", config.ChannelMapHash);
            foreach (var kv in config.ChannelMap.ControlChannels)
                _channelMap.ControlChannels[kv.Key] = kv.Value;
            foreach (var kv in config.ChannelMap.TelemetryChannels)
                _channelMap.TelemetryChannels[kv.Key] = kv.Value;
            foreach (var kv in config.ChannelMap.VideoStreams)
            {
                if (!string.IsNullOrEmpty(kv.Value.StreamId))
                    _channelMap.VideoStreams[kv.Value.StreamId] = kv.Value;
                else
                    _channelMap.VideoStreams[kv.Key] = kv.Value;
            }
        }

        var buildInfo = _buildInfo.GetBuildInfo();
        try
        {
            await connectionServer.ReportOnboardVersion(buildInfo.Branch, buildInfo.Commit);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to report onboard version to server");
        }

        ConnectionStateChanged?.Invoke(this, HubConnectionState.Connected);
        
        foreach (var service in _discoveredServices)
        {
            try
            {
                await service.OnConnectedAsync(_connection);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error initializing service {Service}", service.ServiceName);
            }
        }
    }

    private async Task<int?> ReRegisterCarAsync()
    {
        try
        {
            var connectionServer = _connection.CreateHubProxy<IConnectionHubServer>();
            var carIdentityKey = _configuration.GetValue<string>("CarIdentityKey");
            var config = await connectionServer.OpenCarConnection(carIdentityKey ?? "", "");
            return config?.ServerAssignedCarId;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to re-register car");
            return null;
        }
    }

    public async Task<ChannelMapSyncResponse?> SyncChannelMapAsync()
    {
        if (_connection.State != HubConnectionState.Connected)
        {
            _logger.LogError("Cannot sync channel map - not connected");
            return null;
        }
        
        if (!ServerAssignedCarId.HasValue)
        {
            _logger.LogError("Cannot sync channel map - ServerAssignedCarId not available");
            return null;
        }
        
        var proxy = _connection.CreateHubProxy<IConnectionHubServer>();
        var request = new ChannelMapSyncRequest 
        { 
            CarId = ServerAssignedCarId.Value, 
            ChannelMap = _channelMap 
        };
        
        _logger.LogInformation("Syncing ChannelMap for CarId {CarId} ({Control} control, {Telemetry} telemetry, {Video} video streams)",
            ServerAssignedCarId.Value, _channelMap.ControlChannels.Count, _channelMap.TelemetryChannels.Count, _channelMap.VideoStreams.Count);
        
        var response = await _connection.InvokeAsync<ChannelMapSyncResponse>("SyncChannelMap", request);
        _lastSync = response;

        // Apply merged map to local in-memory state so subsequent hashes agree with server.
        // Server's response carries the LWW-merged values + ModifiedAt for each item.
        foreach (var kv in response.ChannelMap.ControlChannels)
        {
            _channelMap.ControlChannels[kv.Key] = kv.Value;
        }
        foreach (var kv in response.ChannelMap.TelemetryChannels)
        {
            _channelMap.TelemetryChannels[kv.Key] = kv.Value;
        }
        foreach (var kv in response.ChannelMap.VideoStreams)
        {
            // VideoStreams dictionary may use StreamId as key; align by StreamId for safety
            if (!string.IsNullOrEmpty(kv.Value.StreamId))
            {
                _channelMap.VideoStreams[kv.Value.StreamId] = kv.Value;
            }
            else
            {
                _channelMap.VideoStreams[kv.Key] = kv.Value;
            }
        }

        try
        {
            await File.WriteAllTextAsync("channelMap.server.json", JsonSerializer.Serialize(response, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to persist channel map sync response");
        }

        _logger.LogInformation("Channel map synced. Hash: {Hash}", response.Hash);
        return response;
    }

    public bool TryLoadPreviousSync()
    {
        try
        {
            if (!File.Exists("channelMap.server.json")) return false;
            
            var json = File.ReadAllText("channelMap.server.json");
            var stored = JsonSerializer.Deserialize<ChannelMapSyncResponse>(json);
            
            if (stored?.ChannelMap == null) return false;
            
            foreach (var kv in stored.ChannelMap.ControlChannels)
            {
                if (_channelMap.ControlChannels.TryGetValue(kv.Key, out var current))
                    current.ServerId = kv.Value.ServerId;
            }
            
            foreach (var kv in stored.ChannelMap.TelemetryChannels)
            {
                if (_channelMap.TelemetryChannels.TryGetValue(kv.Key, out var current))
                    current.ServerId = kv.Value.ServerId;
            }
            
            foreach (var kv in stored.ChannelMap.VideoStreams)
            {
                if (_channelMap.VideoStreams.TryGetValue(kv.Key, out var current))
                    current.ServerId = kv.Value.ServerId;
            }
            
            _lastSync = stored;
            _logger.LogInformation("Loaded previous channel map sync with hash {Hash}", stored.Hash);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to load previous channel map sync");
            return false;
        }
    }

    public async Task NotifyAsync(string method, object? arg)
    {
        if (_connection.State != HubConnectionState.Connected)
        {
            _logger.LogWarning("Cannot invoke {Method} - not connected", method);
            return;
        }
        await _connection.InvokeAsync(method, arg);
    }

    public async Task<T?> InvokeAsync<T>(string method, CancellationToken cancellationToken = default, params object?[] args)
    {
        if (_connection.State != HubConnectionState.Connected)
        {
            _logger.LogWarning("Cannot invoke {Method} - not connected", method);
            return default;
        }
        return await _connection.InvokeAsync<T>(method, cancellationToken, args);
    }

    public void Dispose()
    {
        _connection.DisposeAsync().AsTask().Wait();
    }
}

public static class VehicleServiceExtensions
{
    public static IServiceCollection AddVehicleServices(this IServiceCollection services)
    {
        services.AddSingleton<IVehicleConnectionManager, VehicleConnectionManager>();
        return services;
    }
    
    public static IServiceCollection AddVehicleService<TService>(this IServiceCollection services) 
        where TService : class, IVehicleService
    {
        services.AddSingleton<IVehicleService, TService>();
        return services;
    }
}
