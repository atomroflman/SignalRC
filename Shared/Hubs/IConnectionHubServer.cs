using LteCar.Shared;
using LteCar.Shared.Channels;
using LteCar.Shared.FileTransfer;
using LteCar.Shared.Video;



public interface IConnectionHubServer
{
    // Connection lifecycle (onboard → server, browser → server)
    Task<CarConfiguration> OpenCarConnection(string carIdentityKey, string channelMapHash);
    Task ReportOnboardVersion(string branch, string? commit);
    Task RegisterAvailableChannelTypes(int carId, AvailableChannelTypes types);
    Task UpdateChannelMap(int carId, ChannelMap channelMap);
    Task<ChannelMapSyncResponse> SyncChannelMap(ChannelMapSyncRequest request);
    Task ReportFileTransferStatus(FileTransferStatusUpdate update);
    Task<CarStateModel[]> UiClientConnected();
    Task SendBashOutput(int carId, string output, bool isError);

    // Control session (browser → server → onboard)
    Task RegisterForControl(int carId);
    Task<string?> AquireCarControl(int carId, SshAuthenticationRequest authRequest);
    Task ReleaseCarControl(int carId, string sessionId);
    Task UpdateChannel(int carId, string sessionId, int channelId, decimal value);
    Task<string?> GetChallenge(int carId);
    Task<FileUploadApproval?> RequestFileUpload(int carId, string sessionId, string filePath);
    Task<ListFilesResponse?> ListFilesOnDevice(int carId, string sessionId, string path);
    Task<bool> DeleteFileOnDevice(int carId, string sessionId, string filePath);
    Task<PingCarResult?> PingCar(int carId);

    // Telemetry (onboard → server, browser → server; formerly ITelemetryServer)
    Task UpdateTelemetry(string carId, string valueName, string value);
    Task SubscribeToCarTelemetry(string carId);
    Task UnsubscribeFromCarTelemetry(string carId);
    Task RegisterAsOnboard(string carId);
    Task SubscribeToChannel(string carId, string channelName);
    Task UnsubscribeFromChannel(string carId, string channelName);

    // Video streams (onboard + browser → server; formerly ICarVideoServer)
    Task ConnectCar(string carIdentityKey);
    Task<IReadOnlyList<VideoStreamMapItem>> GetVideoStreamsForCar(int carId);
    Task ActivateStream(int streamId);
    Task DeactivateStream(int streamId);
    Task StartVideoStream(int streamId);
    Task ChangeVideoStreamSettings(int streamId, VideoStreamMapItem settings);
    Task StopVideoStream(int streamId);
    Task SetVideoStreamEnabled(int carId, int streamId, bool enabled);

    // Diagnostics (browser → server → onboard)
    Task<OnboardDiagnosticsReport> GetOnboardDiagnostics(int carId);
    Task<OnboardDiagnosticsReport> RunOnboardStartupTest(int carId);
}