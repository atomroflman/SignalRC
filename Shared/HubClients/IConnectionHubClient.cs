namespace LteCar.Shared.HubClients;

// ponytail: union of the client subsets the server's CarConnectionHub
// pushes calls through. The hub is typed Hub<IConnectionHubClient>; each
// Onboard service implements only the narrow subset (IControlClient /
// ITelemetryClient / ICarVideoClient / IDiagnosticsClient) and registers
// that on the shared connection. SignalR routes incoming RPCs by method
// name, so it works.
public interface IConnectionHubClient : IControlClient, ITelemetryClient, ICarVideoClient, IDiagnosticsClient
{
}