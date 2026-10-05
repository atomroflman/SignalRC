using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Diagnostics;
using LteCar.Server.Configuration;
using LteCar.Server.Data;
using LteCar.Server.Services;
using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.FileTransfer;
using LteCar.Shared.HubClients;
using LteCar.Shared.Video;
using MessagePack;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Sqids;

namespace LteCar.Server.Hubs;

public class CarConnectionHub : Hub<IConnectionHubClient>, IConnectionHubServer
{
    // Handshake Overview:
    // 1. Car connects and (optionally) calls SyncChannelMap first sending full ChannelMap.
    // 2. Server upserts channels/video streams, assigns compact numeric IDs and returns:
    //      - Hash (SHA256 of canonical map) stored on both sides
    //      - Normalized ChannelMap + dictionaries name->int id for bandwidth-efficient future messages
    // 3. OpenCarConnection now only needs the hash to determine if a legacy update is required.
    // This reduces startup round trips and prepares for ID-based messaging.
    //
    // ponytail: this hub is the single vehicle-side hub. It used to be CarConnectionHub
    // + CarControlHub + TelemetryHub + CarVideoHub across four sockets. The Onboard now
    // opens one SignalR connection that carries control, telemetry, video signaling,
    // file transfer, channel CRUD, and connection state. Browser pages go to the same URL.
    public ILogger<CarConnectionHub> Logger { get; }
    private readonly VideoStreamReceiverService _streamService;
    private readonly IConfigurationService _configService;
    private readonly CarConnectionStore _connectionStore;
    private readonly SqidsEncoder<long> _sqidsEncoder;
    private readonly ActiveVideoStreamViewerRegistry _viewerRegistry;
    private readonly AvailableTypesRegistry _availableTypes;

    public CarConnectionHub(
        IConfigurationService configService,
        ILogger<CarConnectionHub> logger,
        VideoStreamReceiverService streamService,
        CarConnectionStore connectionStore,
        SqidsEncoder<long> sqidsEncoder,
        ActiveVideoStreamViewerRegistry viewerRegistry,
        AvailableTypesRegistry availableTypes)
    {
        Logger = logger;
        _streamService = streamService;
        _configService = configService;
        _connectionStore = connectionStore;
        _sqidsEncoder = sqidsEncoder;
        _viewerRegistry = viewerRegistry;
        _availableTypes = availableTypes;
    }

    public VideoStreamReceiverService VideoStreamReceiverService => _streamService;

    public Task<CarStateModel[]> UiClientConnected()
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var states = dbContext.Cars
            .AsNoTracking()
            .ToList()
            .Select(car => {
                var hasConnectionInfo = _connectionStore.TryGetValue(car.Id.ToString(), out var connectionInfo);
                return new CarStateModel
                {
                    Id = car.Id.ToString(),
                    IsConnected = hasConnectionInfo,
                    DriverId = hasConnectionInfo ? connectionInfo?.DriverId : null,
                    DriverName = hasConnectionInfo ? connectionInfo?.DriverName : null
                };
            })
            .ToArray();
        return Task.FromResult(states);
    }
    
    public async Task<CarConfiguration> OpenCarConnection(string carIdentityKey, string channelMapHash)
    {
        Logger.LogInformation("Car with identity key '{CarIdentityKey}' attempting to connect: ChannelHash '{ChannelMapHash}'", carIdentityKey, channelMapHash);
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var car = dbContext.Cars.FirstOrDefault(c => c.CarIdentityKey == carIdentityKey);
        if (car == null)
        {
            Logger.LogWarning($"Car with identity key {carIdentityKey} not found. Creating a new one.");
            car = new Car() 
            { 
                CarIdentityKey = carIdentityKey,
                Name = carIdentityKey // Initial name is the identity key, user can change it later
            };
            dbContext.Cars.Add(car);
        }
        car.LastSeen = DateTime.UtcNow;
        await dbContext.SaveChangesAsync();
        
        // Add connection to SignalR group by CarId for targeted messaging
        await Groups.AddToGroupAsync(Context.ConnectionId, $"Car-{car.Id}");
        Logger.LogInformation($"Car '{car.Name}' (ID: {car.Id}) connected and added to group 'Car-{car.Id}'");
        
        var janusServerHost = _configService.Janus.HostName;
        if (string.IsNullOrEmpty(janusServerHost))
        {
            janusServerHost = System.Net.Dns.GetHostName();
            Logger.LogWarning($"Janus server host is not configured. Using default: {janusServerHost}");
        }

        var carConfig = new CarConfiguration();
        carConfig.ServerAssignedCarId = car.Id;

        // SPOT: Server is the source of truth for channel configuration.
        // Compare hashes and push the server's config if the client is out of date.
        // If the server has no config yet, the client receives an empty map and hash;
        // configuration must be created through the UI or a template.
        var serverMap = await ChannelMapMapper.FromDbAsync(car.Id, dbContext);
        var serverHash = ChannelMapHashProvider.GenerateHash(serverMap);
        car.ChannelMapHash = serverHash;
        carConfig.ChannelMapHash = serverHash;

        var hasServerConfig = serverMap.ControlChannels.Count > 0
            || serverMap.TelemetryChannels.Count > 0
            || serverMap.VideoStreams.Count > 0
            || serverMap.PinManagers.Count > 0;

        if (!hasServerConfig)
        {
            Logger.LogWarning("Car ID {CarId} has no server-side channel config. Configure via UI or template.", car.Id);
            carConfig.ChannelMap = serverMap;
        }
        else if (serverHash != channelMapHash)
        {
            Logger.LogInformation("Car ID {CarId} channel map hash mismatch. Server: '{ServerHash}' Client: '{ClientHash}'. Pushing server config.", car.Id, serverHash, channelMapHash);
            carConfig.ChannelMap = serverMap;
            await Clients.Caller.ApplyChannelMap(serverMap, serverHash);
        }
        else
        {
            Logger.LogInformation("Car ID {CarId} channel map hash matches. No update required.", car.Id);
        }

        await dbContext.SaveChangesAsync();
        
        var connectionInfo = _connectionStore.RegisterConnection(car.Id.ToString(), Context.ConnectionId);
        connectionInfo.CarConfiguration = carConfig;

        await Clients.All.CarStateUpdated(new CarStateModel() {
            Id = car.Id.ToString(),
            IsConnected = true,
            DriverId = connectionInfo.DriverId,
            DriverName = connectionInfo.DriverName
        });
        return carConfig;
    }

    public async Task Test() 
    {
        await Task.CompletedTask;
        Logger.LogInformation("Test Invoked");
    }

    public Task ReportOnboardVersion(string branch, string? commit)
    {
        var carId = _connectionStore.FirstOrDefault(kv => kv.Value.ConnectionId == Context.ConnectionId).Key;
        if (carId == null)
        {
            Logger.LogWarning("ReportOnboardVersion received without an active car connection");
            return Task.CompletedTask;
        }
        _connectionStore.TrySetOnboardVersion(carId, branch, commit);
        Logger.LogInformation("Car {CarId} reports onboard version {Branch}@{Commit}", carId, branch, commit);
        return Task.CompletedTask;
    }

    public Task RegisterAvailableChannelTypes(int carId, AvailableChannelTypes types)
    {
        _availableTypes.Set(carId, types);
        Logger.LogInformation("Car {CarId} registered {Control} control types and {Telemetry} telemetry types",
            carId, types.ControlTypes.Length, types.TelemetryTypes.Length);
        return Task.CompletedTask;
    }

    public override Task OnConnectedAsync()
    {
        Logger.LogInformation($"Client connected: {Clients.Caller}");
        return base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        Logger.LogWarning($"Client disconnected: {exception}");
        if (_connectionStore.TryRemoveConnection(Context.ConnectionId, out var carId, out var connectionInfo) && carId != null)
        {
            await Clients.All.CarStateUpdated(new CarStateModel()
            {
                Id = carId,
                IsConnected = false,
                DriverId = connectionInfo?.DriverId,
                DriverName = connectionInfo?.DriverName
            });
        }

        var stoppedStreamIds = _viewerRegistry.RemoveConnection(Context.ConnectionId);
        foreach (var streamId in stoppedStreamIds)
        {
            var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
            var stream = await dbContext.CarVideoStreams.FirstOrDefaultAsync(s => s.Id == streamId);
            if (stream == null)
                continue;
            await StopStreamForViewersAsync(stream);
        }

        await base.OnDisconnectedAsync(exception);
    }

    [Obsolete("Server-side channel mutations must go through the UI API.")]
    public async Task UpdateChannelMap(int carId, ChannelMap channelMap)
    {
        Logger.LogWarning("UpdateChannelMap is obsolete and ignored. Car {CarId} attempted to push a channel map.", carId);
        await Task.CompletedTask;
    }


    public async Task<ChannelMapSyncResponse> SyncChannelMap(ChannelMapSyncRequest request)
    {
        try
        {
            Logger.LogInformation("SyncChannelMap invoked for car {CarId}", request.CarId);
            var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
            var car = await dbContext.Cars.FirstOrDefaultAsync(c => c.Id == request.CarId);
            if (car == null)
            {
                Logger.LogError($"Car with ID {request.CarId} not found in SyncChannelMap. This should not happen - OpenCarConnection should be called first.");
                throw new InvalidOperationException($"Car with ID {request.CarId} not found. Please call OpenCarConnection first.");
            }

            // SPOT: The server is the sole source of truth. SyncChannelMap only returns the
            // current server-side channel configuration; the client's upload is ignored.
            var serverMap = await ChannelMapMapper.FromDbAsync(car.Id, dbContext);
            var hash = ChannelMapHashProvider.GenerateHash(serverMap);
            car.ChannelMapHash = hash;
            car.LastSeen = DateTime.UtcNow;
            await dbContext.SaveChangesAsync();

            var controlIds = serverMap.ControlChannels.ToDictionary(kv => kv.Key, kv => kv.Value.ServerId ?? 0);
            var telemetryIds = serverMap.TelemetryChannels.ToDictionary(kv => kv.Key, kv => kv.Value.ServerId ?? 0);
            var videoIds = serverMap.VideoStreams.ToDictionary(kv => kv.Key, kv => kv.Value.ServerId ?? 0);

            var response = new ChannelMapSyncResponse
            {
                Hash = hash,
                ChannelMap = serverMap,
                ControlIds = controlIds,
                TelemetryIds = telemetryIds,
                VideoIds = videoIds,
                GeneratedAtUtc = DateTime.UtcNow
            };

            Logger.LogInformation("ChannelMap sync complete for {CarId} hash {Hash}", request.CarId, hash);
            return response;
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "FATAL ERROR in SyncChannelMap for car {CarId}", request?.CarId.ToString() ?? "UNKNOWN");
            throw;
        }
    }

    public async Task ReportFileTransferStatus(FileTransferStatusUpdate update)
    {
        Logger.LogInformation("Device reports transfer {Token} status: {Status}", update.Token, update.Status);

        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var transfer = await dbContext.FileTransfers
            .FirstOrDefaultAsync(f => f.DownloadToken == update.Token);
        if (transfer == null)
        {
            Logger.LogWarning("Transfer with token {Token} not found", update.Token);
            return;
        }

        if (update.Status == FileTransferStatus.Completed)
        {
            if (string.IsNullOrEmpty(update.Sha256Hash) ||
                !string.Equals(transfer.Sha256Hash, update.Sha256Hash, StringComparison.OrdinalIgnoreCase))
            {
                Logger.LogWarning("Hash mismatch for transfer {Token}: expected {Expected}, got {Actual}",
                    update.Token, transfer.Sha256Hash, update.Sha256Hash);
                return;
            }

            Logger.LogInformation("Transfer {Token} completed, hash verified. Cleaning up.", update.Token);

            if (!string.IsNullOrEmpty(transfer.StoragePath) && File.Exists(transfer.StoragePath))
                File.Delete(transfer.StoragePath);

            dbContext.FileTransfers.Remove(transfer);
            await dbContext.SaveChangesAsync();
            return;
        }

        transfer.Status = update.Status;
        await dbContext.SaveChangesAsync();
    }

    // -- Control session methods (relay to the car's ControlService) ----------------

    public async Task RegisterForControl(int carId)
    {
        Logger.LogDebug($"Invoked: RegisterForControl({carId}) => connection {Context.ConnectionId}");
        await Groups.AddToGroupAsync(Context.ConnectionId, $"Car-{carId}");
    }

    public async Task<string?> AquireCarControl(int carId, SshAuthenticationRequest authRequest)
    {
        Logger.LogDebug($"Invoked: AquireCarControl({carId}, challenge={authRequest.Challenge[..Math.Min(10, authRequest.Challenge.Length)]}...) as {Context.User?.Identity?.Name}");
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
        {
            Logger.LogDebug("Car not connected");
            return null;
        }
        var session = await Clients.Client(connectionInfo.ConnectionId!).AquireCarControl(authRequest);
        Logger.LogDebug($"Session returned: {session}");

        if (!string.IsNullOrEmpty(session))
        {
            await EnsureUserCarSetupExists(carId);
            await MarkUserAsActiveVehicle(carId);
            await MarkUserAsHasControlledCar(carId);
            await UpdateCarUiDriverStateAsync(carId);
        }
        return session;
    }

    public async Task ReleaseCarControl(int carId, string sessionId)
    {
        Logger.LogDebug($"Invoked: ReleaseCarControl({carId}, {sessionId})");
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return;
        await Clients.Client(connectionInfo.ConnectionId!).ReleaseCarControl(sessionId);
        await ClearUserActiveVehicle(carId);
        await UpdateCarUiDriverStateAsync(carId);
    }

    public async Task UpdateChannel(int carId, string sessionId, int channelId, decimal value)
    {
        Logger.LogDebug($"Invoked: UpdateChannel({carId}, {sessionId}, {channelId}, {value})");
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return;
        // TODO: Cache einbauen
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var channelName = dbContext.Set<CarChannel>().FirstOrDefault(e => e.Id == channelId)?.ChannelName;
        if (channelName == null)
        {
            Logger.LogError($"Channel ID: {channelId} unknown");
            return;
        }
        await Clients.Client(connectionInfo.ConnectionId!).UpdateChannel(sessionId, channelName, value);
    }

    public async Task<string?> GetChallenge(int carId)
    {
        Logger.LogDebug($"Invoked: GetChallenge({carId})");
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return null;
        var challenge = await Clients.Client(connectionInfo.ConnectionId!).GetChallenge();
        Logger.LogDebug($"Challenge returned: {challenge?[..Math.Min(20, challenge?.Length ?? 0)]}...");
        return challenge;
    }

    public async Task<FileUploadApproval?> RequestFileUpload(int carId, string sessionId, string filePath)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return null;

        var approved = await Clients.Client(connectionInfo.ConnectionId!).ApproveFileUpload(sessionId, filePath);
        if (!approved)
            return null;

        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var transfer = new FileTransfer
        {
            CarId = carId,
            FileName = filePath,
            Status = FileTransferStatus.Uploading
        };
        dbContext.FileTransfers.Add(transfer);
        await dbContext.SaveChangesAsync();

        Logger.LogInformation("File upload approved for car {CarId}, path '{FilePath}', transfer {TransferId}",
            carId, filePath, transfer.Id);

        return new FileUploadApproval { Token = transfer.DownloadToken };
    }

    public async Task<ListFilesResponse?> ListFilesOnDevice(int carId, string sessionId, string path)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return null;
        return await Clients.Client(connectionInfo.ConnectionId!).ListFiles(sessionId, path);
    }

    public async Task<bool> DeleteFileOnDevice(int carId, string sessionId, string filePath)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return false;
        return await Clients.Client(connectionInfo.ConnectionId!).DeleteFile(sessionId, filePath);
    }

    public async Task<PingCarResult?> PingCar(int carId)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
        {
            Logger.LogDebug($"PingCar: Car {carId} not connected");
            return null;
        }
        var sw = Stopwatch.StartNew();
        var carTimestamp = await Clients.Client(connectionInfo.ConnectionId!).Ping();
        sw.Stop();
        return new PingCarResult(carTimestamp, sw.Elapsed.TotalMilliseconds);
    }

    public async Task SendBashOutput(int carId, string output, bool isError)
    {
        await Clients.All.SendBashOutput(carId, output, isError);
    }

    // -- User state plumbing --------------------------------------------------------

    private async Task EnsureUserCarSetupExists(int carId)
    {
        try
        {
            var user = await GetCurrentUserAsync();
            if (user == null)
            {
                Logger.LogWarning($"No authenticated user found for car {carId}");
                return;
            }
            var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
            var car = await dbContext.Cars.FirstOrDefaultAsync(c => c.Id == carId);
            if (car == null)
            {
                Logger.LogWarning($"Car with ID {carId} not found. Car should have been registered via OpenCarConnection.");
                return;
            }
            var existingSetup = await dbContext.UserSetups
                .FirstOrDefaultAsync(u => u.UserId == user.Id && u.CarId == car.Id);
            if (existingSetup == null)
            {
                Logger.LogInformation($"Creating UserCarSetup for user {user.Id} and car {carId}");
                dbContext.UserSetups.Add(new UserCarSetup { UserId = user.Id, CarId = car.Id });
                await dbContext.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, $"Error ensuring UserCarSetup exists for car {carId}");
        }
    }

    private async Task MarkUserAsHasControlledCar(int carId)
    {
        try
        {
            var user = await GetCurrentUserAsync();
            if (user == null) return;
            if (!user.HasControlledCar)
            {
                user.HasControlledCar = true;
                var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
                await dbContext.SaveChangesAsync();
            }
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, $"Error marking user as having controlled car {carId}");
        }
    }

    private async Task MarkUserAsActiveVehicle(int carId)
    {
        try
        {
            var user = await GetCurrentUserAsync();
            if (user == null) return;
            if (user.ActiveVehicleId == carId) return;
            user.ActiveVehicleId = carId;
            var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
            await dbContext.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Error marking active vehicle for car {CarId}", carId);
        }
    }

    private async Task ClearUserActiveVehicle(int carId)
    {
        try
        {
            var user = await GetCurrentUserAsync();
            if (user == null || user.ActiveVehicleId != carId) return;
            user.ActiveVehicleId = null;
            var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
            await dbContext.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Error clearing active vehicle for car {CarId}", carId);
        }
    }

    private async Task UpdateCarUiDriverStateAsync(int carId)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo))
            return;
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var activeDriver = await dbContext.Users.FirstOrDefaultAsync(user => user.ActiveVehicleId == carId);
        connectionInfo.DriverId = activeDriver?.Id.ToString();
        connectionInfo.DriverName = activeDriver?.Name ?? activeDriver?.LoginName;
        await Clients.All.CarStateUpdated(new CarStateModel
        {
            Id = carId.ToString(),
            IsConnected = true,
            DriverId = connectionInfo.DriverId,
            DriverName = connectionInfo.DriverName
        });
    }

    private async Task<User?> GetCurrentUserAsync()
    {
        if (Context.User?.Identity?.IsAuthenticated != true)
            return null;
        var sessionToken = Context.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(sessionToken))
            return null;
        var sessionId = _sqidsEncoder.Decode(sessionToken).FirstOrDefault();
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        return await dbContext.Users.FirstOrDefaultAsync(u => u.SessionId == sessionId);
    }

    // -- Telemetry (formerly TelemetryHub) ------------------------------------------

    public Task UpdateTelemetry(string carId, string valueName, string value)
    {
        return Clients.Group($"car:{carId}").UpdateTelemetry(valueName, value);
    }

    public Task SubscribeToCarTelemetry(string carId)
    {
        return Groups.AddToGroupAsync(Context.ConnectionId, $"car:{carId}");
    }

    public Task UnsubscribeFromCarTelemetry(string carId)
    {
        return Groups.RemoveFromGroupAsync(Context.ConnectionId, $"car:{carId}");
    }

    public Task RegisterAsOnboard(string carId)
    {
        return Groups.AddToGroupAsync(Context.ConnectionId, $"onboard-{carId}");
    }

    public async Task SubscribeToChannel(string carId, string channelName)
    {
        await Clients.Group($"onboard-{carId}").SubscribeToTelemetryChannel(channelName);
        await PersistTelemetrySubscription(carId, channelName, add: true);
    }

    public async Task UnsubscribeFromChannel(string carId, string channelName)
    {
        await Clients.Group($"onboard-{carId}").UnsubscribeFromTelemetryChannel(channelName);
        await PersistTelemetrySubscription(carId, channelName, add: false);
    }

    private async Task PersistTelemetrySubscription(string carId, string channelName, bool add)
    {
        var db = Context.GetHttpContext()?.RequestServices.GetService<LteCarContext>();
        if (db == null) return;
        if (!int.TryParse(carId, out var carIdInt))
        {
            Logger.LogWarning("PersistTelemetrySubscription: invalid carId {CarId}", carId);
            return;
        }

        var user = await HubUserHelper.GetUserAsync(Context.GetHttpContext()!, db);
        if (user == null)
        {
            Logger.LogWarning("PersistTelemetrySubscription: no authenticated user for car {CarId} channel {Channel}", carId, channelName);
            return;
        }

        var setup = await db.UserSetups
            .FirstOrDefaultAsync(s => s.UserId == user.Id && s.CarId == carIdInt);
        if (setup == null)
        {
            Logger.LogWarning("PersistTelemetrySubscription: no UserSetup for user {UserId} car {CarId} channel {Channel}", user.Id, carId, channelName);
            return;
        }

        var telemetry = await db.CarTelemetry
            .FirstOrDefaultAsync(t => t.CarId == carIdInt && t.ChannelName == channelName);
        if (telemetry == null)
        {
            Logger.LogWarning("PersistTelemetrySubscription: unknown CarTelemetry for car {CarId} channel {Channel}", carId, channelName);
            return;
        }

        var existing = await db.UserSetupTelemetries
            .FirstOrDefaultAsync(t => t.UserSetupId == setup.Id && t.CarTelemetryId == telemetry.Id);

        if (add && existing == null)
        {
            db.UserSetupTelemetries.Add(new UserSetupTelemetry
            {
                UserSetupId = setup.Id,
                CarTelemetryId = telemetry.Id,
            });
            await db.SaveChangesAsync();
        }
        else if (!add && existing != null)
        {
            db.UserSetupTelemetries.Remove(existing);
            await db.SaveChangesAsync();
        }
    }

    // -- Video (formerly CarVideoHub) ----------------------------------------------

    public async Task ConnectCar(string carIdentityKey)
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var car = dbContext.Cars
            .Include(c => c.VideoStreams)
            .FirstOrDefault(c => c.CarIdentityKey == carIdentityKey);
        if (car == null)
        {
            Logger.LogWarning("Car with identity key {CarIdentityKey} not found", carIdentityKey);
            throw new InvalidOperationException($"Car with identity key {carIdentityKey} not found!");
        }
        await this.AddCarToGroupAsync(car.Id);
        Logger.LogInformation("Car {CarIdentityKey} connected with ID {CarId}. Synchronizing viewer-driven video streams.", carIdentityKey, car.Id);

        foreach (var stream in car.VideoStreams.Where(stream => stream.Enabled && _viewerRegistry.GetViewerCount(stream.Id) > 0))
        {
            await StartStreamForViewersAsync(stream);
        }
    }

    public async Task StartVideoStream(int streamId)
    {
        Logger.LogInformation($"Starting Video Stream: {streamId}");
        var stream = await GetStreamAsync(streamId);
        await StartStreamForViewersAsync(stream);
    }

    private async Task SanitizeStreamSettings(CarVideoStream s)
    {
        if (s.Bitrate < 256 || s.Bitrate > 10_000_000)
        {
            Logger.LogWarning("Sanitizing bitrate {BitrateKbps} for stream {StreamId}", s.Bitrate, s.StreamId);
            s.Bitrate = Math.Clamp(s.Bitrate, 256, 10_000_000);
        }
        if (s.Framerate < 1 || s.Framerate > 60)
        {
            Logger.LogWarning("Sanitizing framerate {Framerate} for stream {StreamId}", s.Framerate, s.StreamId);
            s.Framerate = Math.Clamp(s.Framerate, 1, 60);
        }
        if (s.Width < 160 || s.Width > 4096)
        {
            Logger.LogWarning("Sanitizing width {Width} for stream {StreamId}", s.Width, s.StreamId);
            s.Width = Math.Clamp(s.Width, 160, 4096);
        }
        if (s.Height < 120 || s.Height > 2160)
        {
            Logger.LogWarning("Sanitizing height {Height} for stream {StreamId}", s.Height, s.StreamId);
            s.Height = Math.Clamp(s.Height, 120, 2160);
        }
        if (s.Brightness < -1 || s.Brightness > 1)
        {
            Logger.LogWarning("Sanitizing brightness {Brightness} for stream {StreamId}", s.Brightness, s.StreamId);
            s.Brightness = Math.Clamp(s.Brightness, -1, 1);
        }
        if (s.Contrast is < 0 or > 16)
        {
            Logger.LogWarning("Sanitizing contrast {Contrast} for stream {StreamId}", s.Contrast, s.StreamId);
            s.Contrast = Math.Clamp(s.Contrast.Value, 0, 16);
        }
        if (s.Gain is < 0)
        {
            Logger.LogWarning("Sanitizing gain {Gain} for stream {StreamId}", s.Gain, s.StreamId);
            s.Gain = 0;
        }
        if (s.EV is < -10 or > 10)
        {
            Logger.LogWarning("Sanitizing EV {EV} for stream {StreamId}", s.EV, s.StreamId);
            s.EV = Math.Clamp(s.EV.Value, -10, 10);
        }
        if (s.Shutter is < 0)
        {
            Logger.LogWarning("Sanitizing shutter {Shutter} for stream {StreamId}", s.Shutter, s.StreamId);
            s.Shutter = 0;
        }
        var validExposures = new[] { "normal", "short", "long", "custom" };
        if (!string.IsNullOrEmpty(s.Exposure) && !validExposures.Contains(s.Exposure, StringComparer.OrdinalIgnoreCase))
        {
            Logger.LogWarning("Sanitizing exposure {Exposure} for stream {StreamId}", s.Exposure, s.StreamId);
            s.Exposure = "normal";
        }
        if (s.Bitrate % 64 != 0)
        {
            var original = s.Bitrate;
            s.Bitrate = (s.Bitrate / 64) * 64;
            Logger.LogWarning("Adjusting bitrate {OriginalBitrateKbps} to nearest multiple of 64: {AdjustedBitrateKbps} for stream {StreamId}", original, s.Bitrate, s.StreamId);
        }
        if (s.Port < _configService.Janus.PortRangeStart || s.Port > _configService.Janus.PortRangeEnd)
        {
            Logger.LogWarning("Sanitizing port {Port} for stream {StreamId}", s.Port, s.StreamId);
            s.Port = _streamService.FindFreePort(s.Protocol);
        }
    }

    public async Task<IReadOnlyList<VideoStreamMapItem>> GetVideoStreamsForCar(int carId)
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var streams = await dbContext.CarVideoStreams
            .Where(s => s.CarId == carId)
            .OrderBy(s => s.Priority)
            .ThenBy(s => s.Name)
            .ToListAsync();

        return streams
            .Select(s => new VideoStreamMapItem()
            {
                Name = s.Name,
                StreamId = s.StreamId,
                Type = s.Type,
                Location = s.Location,
                Width = s.Width,
                Height = s.Height,
                Bitrate = s.Bitrate,
                Framerate = s.Framerate,
                Brightness = s.Brightness,
                Gain = s.Gain,
                Shutter = s.Shutter,
                Contrast = s.Contrast,
                EV = s.EV,
                Exposure = s.Exposure,
                Enabled = s.Enabled,
                CameraDevice = s.CameraDevice,
                ModifiedAt = s.ModifiedAt,
                Port = s.Port,
                RpiCamId = s.RpiCamId,
                ServerId = s.Id
            })
            .ToList();
    }

    public async Task ActivateStream(int streamId)
    {
        var stream = await GetStreamAsync(streamId);
        if (!stream.Enabled)
        {
            throw new HubException($"Stream {stream.Name} is disabled.");
        }
        var firstViewer = _viewerRegistry.Activate(Context.ConnectionId, streamId);
        Logger.LogInformation("Connection {ConnectionId} activated stream {StreamId}. Viewers: {ViewerCount}", Context.ConnectionId, streamId, _viewerRegistry.GetViewerCount(streamId));
        if (firstViewer)
        {
            await StartStreamForViewersAsync(stream);
        }
    }

    [Obsolete]
    public async Task DeactivateStream(int streamId)
    {
        Logger.LogInformation("Connection {ConnectionId} deactivated stream {StreamId}. (Legacy Endpoint!!!)", Context.ConnectionId, streamId);
        await StopVideoStream(streamId);
    }

    public async Task StopVideoStream(int streamId)
    {
        Logger.LogInformation("Connection {ConnectionId} deactivated stream {StreamId}.", Context.ConnectionId, streamId);
        var stream = await GetStreamAsync(streamId);
        await StopStreamForViewersAsync(stream);
    }

    public async Task ChangeVideoStreamSettings(int streamId, VideoStreamMapItem settings)
    {
        var stream = await GetStreamAsync(streamId);
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        Logger.LogInformation("Changing video stream settings for stream {StreamId} ({StreamName}) for car {CarId}", stream.Id, stream.Name, stream.CarId);
        
        stream.Bitrate = settings.Bitrate ?? stream.Bitrate;
        stream.Brightness = settings.Brightness ?? stream.Brightness;
        stream.Width = settings.Width ?? stream.Width;
        stream.Height = settings.Height ?? stream.Height;
        stream.Framerate = settings.Framerate ?? stream.Framerate;
        stream.Gain = settings.Gain ?? stream.Gain;
        stream.Shutter = settings.Shutter ?? stream.Shutter;
        stream.Contrast = settings.Contrast ?? stream.Contrast;
        stream.EV = settings.EV ?? stream.EV;
        stream.Exposure = settings.Exposure ?? stream.Exposure;
        stream.ModifiedAt = DateTime.UtcNow;
        
        await SanitizeStreamSettings(stream);
        await dbContext.SaveChangesAsync();
        
        Logger.LogInformation("Restarting video stream {StreamId} ({StreamName}) for car {CarId} with new settings", stream.Id, stream.Name, stream.CarId);

        settings.Name = stream.Name;
        settings.Type = stream.Type;
        settings.Location = stream.Location;
        settings.Enabled = stream.Enabled;
        settings.CameraDevice = stream.CameraDevice;
        settings.RpiCamId = stream.RpiCamId;
        settings.Port = stream.Port;
        settings.Width = stream.Width;
        settings.Height = stream.Height;
        settings.Framerate = stream.Framerate;
        settings.Bitrate = stream.Bitrate;
        settings.Brightness = stream.Brightness;
        settings.Gain = stream.Gain;
        settings.Shutter = stream.Shutter;
        settings.Contrast = stream.Contrast;
        settings.EV = stream.EV;
        settings.Exposure = stream.Exposure;
        settings.ServerId = stream.Id;
        settings.ModifiedAt = stream.ModifiedAt;

        await Clients.Car(stream.CarId).UpdateVideoStream(stream.StreamId, settings);
    }

    public async Task<OnboardDiagnosticsReport> GetOnboardDiagnostics(int carId)
    {
        return await ForwardDiagnosticsAsync(carId, "GetOnboardDiagnostics");
    }

    public async Task<OnboardDiagnosticsReport> RunOnboardStartupTest(int carId)
    {
        return await ForwardDiagnosticsAsync(carId, "RunOnboardStartupTest");
    }

    private async Task<OnboardDiagnosticsReport> ForwardDiagnosticsAsync(int carId, string methodName)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo) || string.IsNullOrEmpty(connectionInfo.ConnectionId))
        {
            Logger.LogWarning("GetOnboardDiagnostics requested for car {CarId}, but no onboard connection is active", carId);
            return new OnboardDiagnosticsReport
            {
                Timestamp = DateTime.UtcNow,
                StreamName = "",
                HasErrors = true,
                Checks = new List<DiagnosticCheck>
                {
                    new()
                    {
                        Step = "0",
                        Title = "Onboard nicht verbunden",
                        Status = DiagnosticStatus.Error,
                        Message = $"Fahrzeug {carId} ist nicht mit dem Server verbunden."
                    }
                }
            };
        }

        Logger.LogInformation("Forwarding diagnostics request {MethodName} for car {CarId} to onboard connection {ConnectionId}", methodName, carId, connectionInfo.ConnectionId);
        var report = methodName == "RunOnboardStartupTest"
            ? await Clients.Client(connectionInfo.ConnectionId).RunOnboardStartupTest()
            : await Clients.Client(connectionInfo.ConnectionId).GetOnboardDiagnostics();
        return report ?? new OnboardDiagnosticsReport
        {
            Timestamp = DateTime.UtcNow,
            StreamName = "",
            HasErrors = true,
            Checks = new List<DiagnosticCheck>
            {
                new()
                {
                    Step = "0",
                    Title = "Leere Diagnose-Antwort",
                    Status = DiagnosticStatus.Error,
                    Message = "Das Onboard hat keine Diagnose-Daten zurückgegeben."
                }
            }
        };
    }

    public async Task SetVideoStreamEnabled(int carId, int streamId, bool enabled)
    {
        await EnsureDriverCanManageStreamAsync(carId);

        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        var stream = await dbContext.CarVideoStreams
            .FirstOrDefaultAsync(s => s.Id == streamId && s.CarId == carId)
            ?? throw new InvalidOperationException($"Video stream with ID {streamId} not found for car {carId}.");

        if (stream.Enabled == enabled)
        {
            return;
        }

        stream.Enabled = enabled;
        await dbContext.SaveChangesAsync();
        Logger.LogInformation("Driver changed enabled state for stream {StreamId} on car {CarId} to {Enabled}", streamId, carId, enabled);

        if (enabled)
        {
            return;
        }

        _viewerRegistry.ClearStream(streamId);
        await StopStreamForViewersAsync(stream);
    }

    private async Task<CarVideoStream> GetStreamAsync(int streamId)
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        return await dbContext.CarVideoStreams
            .FirstOrDefaultAsync(s => s.Id == streamId)
            ?? throw new InvalidOperationException($"Video stream with ID {streamId} not found.");
    }

    private async Task StartStreamForViewersAsync(CarVideoStream stream)
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        Logger.LogInformation("Starting video stream {StreamId} ({StreamName}) for car {CarId}", stream.Id, stream.Name, stream.CarId);
        await _streamService.StartStreamAsync(stream.Id);
        stream.IsActive = true;
        await dbContext.SaveChangesAsync();
        await Clients.Car(stream.CarId).StartVideoStream(stream.StreamId);
    }

    private async Task StopStreamForViewersAsync(CarVideoStream stream)
    {
        var dbContext = Context.GetHttpContext()!.RequestServices.GetRequiredService<LteCarContext>();
        Logger.LogInformation("Stopping video stream {StreamId} ({StreamName}) for car {CarId}", stream.Id, stream.Name, stream.CarId);
        await Clients.Car(stream.CarId).StopVideoStream(stream.StreamId);
        await _streamService.StopStream(stream.Id);
        stream.IsActive = false;
        await dbContext.SaveChangesAsync();
    }

    private async Task EnsureDriverCanManageStreamAsync(int carId)
    {
        var httpContext = Context.GetHttpContext()
            ?? throw new HubException("No HTTP context available for video hub request.");
        var dbContext = httpContext.RequestServices.GetRequiredService<LteCarContext>();
        var user = await HubUserHelper.GetUserAsync(httpContext, dbContext);
        if (user == null || string.IsNullOrWhiteSpace(user.LoginName))
        {
            throw new HubException("You must be logged in to enable or disable streams.");
        }

        var hasSetup = await dbContext.UserSetups.AnyAsync(setup => setup.UserId == user.Id && setup.CarId == carId);
        if (!hasSetup)
        {
            throw new HubException("You do not have access to manage this vehicle.");
        }

        if (user.ActiveVehicleId != carId)
        {
            throw new HubException("You must actively control this vehicle to change stream enable state.");
        }
    }

    // ponytail: setup-node deletion needs explicit link cleanup; FK is ClientCascade so EF doesn't auto-include links
    private static void DeleteSetupNodes<TNode>(LteCarContext dbContext, List<TNode> nodes) where TNode : UserSetupFlowNodeBase
    {
        if (nodes.Count == 0) return;
        var nodeIds = nodes.Select(n => n.Id).ToList();
        var links = dbContext.Set<UserSetupLink>()
            .Where(l => nodeIds.Contains(l.UserSetupFromNodeId) || nodeIds.Contains(l.UserSetupToNodeId))
            .ToList();
        foreach (var link in links) dbContext.Set<UserSetupLink>().Remove(link);
        foreach (var node in nodes) dbContext.Set<TNode>().Remove(node);
    }

    Task<IReadOnlyList<VideoStreamMapItem>> IConnectionHubServer.GetVideoStreamsForCar(int carId)
    {
        throw new NotImplementedException();
    }
}