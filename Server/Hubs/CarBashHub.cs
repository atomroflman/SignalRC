using System.Collections.Concurrent;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Security;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using SignalRC.Server.Data;
using SignalRC.Server.Security;

namespace SignalRC.Server.Hubs;

// Docs/VehicleKeyAuth.md (L7): a remote shell on the vehicle. The vehicle registers with a
// signature of its device key, only the driver who holds the control session may open a
// terminal and send commands, and only the registered vehicle connection may answer.
public class CarBashHub : Hub<ICarBashClient>, ICarBashServer
{
    private static readonly ConcurrentDictionary<string, string> _carConnections = new();
    private static readonly ConcurrentDictionary<string, string> _webClientConnections = new();
    private readonly IHubContext<CarBashHub, ICarBashClient> _hubContext;
    private readonly ILogger<CarBashHub> _logger;

    public CarBashHub(IHubContext<CarBashHub, ICarBashClient> hubContext, ILogger<CarBashHub> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    private T Service<T>() where T : notnull => Context.GetHttpContext()!.RequestServices.GetRequiredService<T>();

    private static string NonceScope(string connectionId) => $"bash:{connectionId}";

    public Task<string> GetNonce() => Task.FromResult(Service<NonceStore>().Issue(NonceScope(Context.ConnectionId)));

    /// <summary>Unsigned registration of older onboards: refused.</summary>
    public Task RegisterCar(string carIdentityKey)
    {
        _logger.LogWarning("Unsigned bash registration for {CarId} refused; the onboard must sign with its device key.", carIdentityKey);
        return Task.CompletedTask;
    }

    public async Task<bool> RegisterCarSigned(string carIdentityKey, string nonce, string signature)
    {
        var car = await FindCarAsync(carIdentityKey);
        if (car?.DevicePublicKey == null
            || !Service<NonceStore>().TryConsume(nonce, NonceScope(Context.ConnectionId))
            || !VehicleKeys.VerifyDeviceSignature(car.DevicePublicKey, nonce, signature))
        {
            _logger.LogWarning("Bash registration for {CarId} refused: no valid device signature", carIdentityKey);
            return false;
        }
        _carConnections[carIdentityKey] = Context.ConnectionId;
        _logger.LogInformation("Car registered for bash: {CarId}", carIdentityKey);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"CarBash-Car-{carIdentityKey}");
        return true;
    }

    public async Task RegisterWebClient(string carIdentityKey)
    {
        if (!await IsDriverAsync(carIdentityKey))
            throw new HubException("Only the driver who controls the vehicle may open its terminal.");
        _webClientConnections[carIdentityKey] = Context.ConnectionId;
        _logger.LogInformation("Web client registered for bash, targeting car: {CarId}", carIdentityKey);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"CarBash-Web-{carIdentityKey}");
    }

    public async Task ExecuteCommand(string carIdentityKey, string command)
    {
        if (await CarConnectionForTerminalAsync(carIdentityKey) is { } carConnectionId)
            await Clients.Client(carConnectionId).OnExecuteCommand(command);
    }

    public async Task ChangeDirectory(string carIdentityKey, string directory)
    {
        if (await CarConnectionForTerminalAsync(carIdentityKey) is { } carConnectionId)
            await Clients.Client(carConnectionId).OnChangeDirectory(directory);
    }

    public async Task SendPrompt(string carIdentityKey)
    {
        if (await CarConnectionForTerminalAsync(carIdentityKey) is { } carConnectionId)
            await Clients.Client(carConnectionId).OnSendPrompt();
    }

    public async Task SendToClient(string carIdentityKey, string methodName, string? data = null)
    {
        // Output only from the registered vehicle itself.
        if (!_carConnections.TryGetValue(carIdentityKey, out var carConnectionId) || carConnectionId != Context.ConnectionId)
            return;
        if (!_webClientConnections.TryGetValue(carIdentityKey, out var webConnectionId))
        {
            _logger.LogDebug("Web client not found for bash output: {CarId}", carIdentityKey);
            return;
        }

        switch (methodName)
        {
            case "OnPrompt":
                await Clients.Client(webConnectionId).OnPrompt(data ?? "");
                break;
            case "OnOutput":
                await Clients.Client(webConnectionId).OnOutput(data ?? "");
                break;
            case "OnError":
                await Clients.Client(webConnectionId).OnError(data ?? "");
                break;
            case "OnExitCode":
                if (int.TryParse(data, out var exitCode))
                    await Clients.Client(webConnectionId).OnExitCode(exitCode);
                break;
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var carToRemove = _carConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
        if (carToRemove != null)
        {
            _carConnections.TryRemove(carToRemove, out _);
            _webClientConnections.TryRemove(carToRemove, out _);
            _logger.LogInformation("Car disconnected from bash: {CarId}", carToRemove);
        }

        var webToRemove = _webClientConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
        if (webToRemove != null)
        {
            _webClientConnections.TryRemove(webToRemove, out _);
            _logger.LogInformation("Web client disconnected from bash: {CarId}", webToRemove);
        }

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>The vehicle connection, if the caller is its registered terminal and still the driver.</summary>
    private async Task<string?> CarConnectionForTerminalAsync(string carIdentityKey)
    {
        if (!_webClientConnections.TryGetValue(carIdentityKey, out var terminal) || terminal != Context.ConnectionId
            || !await IsDriverAsync(carIdentityKey))
        {
            _logger.LogWarning("Bash command for {CarId} refused: caller is not the driver's terminal", carIdentityKey);
            return null;
        }
        if (!_carConnections.TryGetValue(carIdentityKey, out var carConnectionId))
        {
            _logger.LogWarning("Car not found for bash: {CarId}", carIdentityKey);
            return null;
        }
        return carConnectionId;
    }

    private async Task<bool> IsDriverAsync(string carIdentityKey)
    {
        var car = await FindCarAsync(carIdentityKey);
        if (car == null) return false;
        var http = Context.GetHttpContext()!;
        return await Service<VehicleAccess>().CanDriveAsync(http, car.Id);
    }

    private Task<Car?> FindCarAsync(string carIdentityKey) =>
        Service<SignalRCContext>().Cars.AsNoTracking().FirstOrDefaultAsync(c => c.CarIdentityKey == carIdentityKey);
}

public interface ICarBashServer
{
    Task<string> GetNonce();
    Task RegisterCar(string carIdentityKey);
    Task<bool> RegisterCarSigned(string carIdentityKey, string nonce, string signature);
    Task RegisterWebClient(string carIdentityKey);
    Task ExecuteCommand(string carIdentityKey, string command);
    Task ChangeDirectory(string carIdentityKey, string directory);
    Task SendPrompt(string carIdentityKey);
    Task SendToClient(string carIdentityKey, string methodName, string? data = null);
}
