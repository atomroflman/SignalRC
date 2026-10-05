namespace LteCar.Shared.HubClients;

// ponytail: subset of the merged hub's client interface used by the Onboard's
// TelemetryService. The server's CarConnectionHub is typed
// Hub<IControlClient, ITelemetryClient, ICarVideoClient>, so each service only
// declares the methods it actually handles. SignalR dispatches by method name.
public interface ITelemetryClient
{
    Task SubscribeToTelemetryChannel(string channelName);
    Task UnsubscribeFromTelemetryChannel(string channelName);
    Task UpdateTelemetry(string channelName, string value);
}