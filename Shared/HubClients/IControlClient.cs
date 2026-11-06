using SignalRC.Shared.Channels;
using SignalRC.Shared.FileTransfer;
using SignalRC.Shared.Flow;

namespace SignalRC.Shared.HubClients;

// ponytail: subset of the merged-hub's client interface used by the Onboard's
// ControlService. The server's CarConnectionHub is typed
// Hub<IControlClient, ITelemetryClient, ICarVideoClient> so each service only
// declares the methods it actually handles. SignalR routes incoming RPCs by
// method name, not interface.
public interface IControlClient
{
    // Broadcasts the server pushes to every client. The Onboard implements
    // them as no-ops; the browser listens via raw connection.on(...) and
    // doesn't care about the interface contract.
    Task CarStateUpdated(CarStateModel state);
    Task SendBashOutput(int carId, string output, bool isError);

    // Control session (onboard)
    Task<string?> AquireCarControl(SshAuthenticationRequest authRequest);
    Task ReleaseCarControl(string sessionId);
    Task UpdateChannel(string sessionId, string channelId, decimal value);
    Task<string?> GetChallenge();
    Task ExecuteBashCommand(string sessionId, string command);

    // File transfer (onboard)
    Task<bool> ApproveFileUpload(string sessionId, string filePath);
    Task<ListFilesResponse> ListFiles(string sessionId, string path);
    Task<bool> DeleteFile(string sessionId, string filePath);
    Task FileReady(FileReadyNotification notification);

    Task<long> Ping();

    // Bidirectional channel sync (onboard)
    Task UpsertControlChannel(string dictKey, ControlChannelMapItem item);
    Task DeleteControlChannel(string dictKey);
    Task UpsertTelemetryChannel(string dictKey, TelemetryChannelMapItem item);
    Task DeleteTelemetryChannel(string dictKey);
    Task UpsertVideoStream(string dictKey, VideoStreamMapItem item);
    Task DeleteVideoStream(string dictKey);

    /// <summary>
    /// Server pushes the entire channel map to the client (SPOT). The client must replace its local config.
    /// </summary>
    Task ApplyChannelMap(ChannelMap channelMap, string channelMapHash);

    // Onboard flow (OnboardFlow-Arbeitspakete.md OF00). All require the control session.
    /// <summary>Replaces the onboard flow in one step; null switches it off (T06).</summary>
    Task ApplyOnboardFlow(string sessionId, OnboardFlowDefinition? flow);
    /// <summary>Value of a handoff node, computed by the browser flow (T08).</summary>
    Task UpdateFlowHandoff(string sessionId, int nodeId, decimal value);
    /// <summary>Detaches the web (E13): the onboard flow runs without the browser. Returns the new state.</summary>
    Task<bool> SetWebDetached(string sessionId, bool detached);
    /// <summary>Bluetooth action (BluetoothAction) for pairing vehicle controllers (T14).</summary>
    Task<BluetoothResult> Bluetooth(string sessionId, string action, string? address);
    /// <summary>Whether a flow editor wants the node values in the status (no session needed: display only).</summary>
    Task SetFlowValueDemand(bool wanted);
}