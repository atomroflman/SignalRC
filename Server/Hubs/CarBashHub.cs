using LteCar.Shared.HubClients;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace LteCar.Server.Hubs;

public class CarBashHub : Hub<ICarBashClient>, ICarBashServer
{
    private static readonly Dictionary<string, string> _carConnections = new();
    private static readonly Dictionary<string, string> _webClientConnections = new();
    private readonly IHubContext<CarBashHub, ICarBashClient> _hubContext;
    private readonly ILogger<CarBashHub> _logger;

    public CarBashHub(IHubContext<CarBashHub, ICarBashClient> hubContext, ILogger<CarBashHub> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task RegisterCar(string carIdentityKey)
    {
        _carConnections[carIdentityKey] = Context.ConnectionId;
        _logger.LogInformation("Car registered for bash: {CarId}", carIdentityKey);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"CarBash-Car-{carIdentityKey}");
    }

    public async Task RegisterWebClient(string carIdentityKey)
    {
        _webClientConnections[carIdentityKey] = Context.ConnectionId;
        _logger.LogInformation("Web client registered for bash, targeting car: {CarId}", carIdentityKey);
        await Groups.AddToGroupAsync(Context.ConnectionId, $"CarBash-Web-{carIdentityKey}");
    }

    public async Task ExecuteCommand(string carIdentityKey, string command)
    {
        if (!_carConnections.TryGetValue(carIdentityKey, out var carConnectionId))
        {
            _logger.LogWarning("Car not found for bash command: {CarId}", carIdentityKey);
            return;
        }

        await Clients.Client(carConnectionId).OnExecuteCommand(command);
    }

    public async Task ChangeDirectory(string carIdentityKey, string directory)
    {
        if (!_carConnections.TryGetValue(carIdentityKey, out var carConnectionId))
        {
            _logger.LogWarning("Car not found for chdir: {CarId}", carIdentityKey);
            return;
        }

        await Clients.Client(carConnectionId).OnChangeDirectory(directory);
    }

    public async Task SendPrompt(string carIdentityKey)
    {
        if (!_carConnections.TryGetValue(carIdentityKey, out var carConnectionId))
        {
            _logger.LogWarning("Car not found for send prompt: {CarId}", carIdentityKey);
            return;
        }

        await Clients.Client(carConnectionId).OnSendPrompt();
    }

    public async Task SendToClient(string carIdentityKey, string methodName, string? data = null)
    {
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
            _carConnections.Remove(carToRemove);
            _webClientConnections.Remove(carToRemove);
            _logger.LogInformation("Car disconnected from bash: {CarId}", carToRemove);
        }

        var webToRemove = _webClientConnections.FirstOrDefault(x => x.Value == Context.ConnectionId).Key;
        if (webToRemove != null)
        {
            _webClientConnections.Remove(webToRemove);
            _logger.LogInformation("Web client disconnected from bash: {CarId}", webToRemove);
        }

        await base.OnDisconnectedAsync(exception);
    }
}

public interface ICarBashServer
{
    Task RegisterCar(string carIdentityKey);
    Task RegisterWebClient(string carIdentityKey);
    Task ExecuteCommand(string carIdentityKey, string command);
    Task ChangeDirectory(string carIdentityKey, string directory);
    Task SendPrompt(string carIdentityKey);
    Task SendToClient(string carIdentityKey, string methodName, string? data = null);
}