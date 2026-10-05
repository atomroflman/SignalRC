namespace LteCar.Onboard;

// ponytail: observer pattern used by services that want to react to the shared
// ServerConnectionService reconnect lifecycle (currently a hook-and-log only;
// nothing here is wired to actually fire, so removing it would be cheap but
// it's referenced from ControlService/TelemetryService/VideoStreamService).
public interface IHubConnectionObserver
{
    Task OnClosed(Exception? exception);
    Task OnReconnected(string? connectionId);
    Task OnReconnecting(Exception? exception);
}