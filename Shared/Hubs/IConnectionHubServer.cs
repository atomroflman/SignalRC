using SignalRC.Shared;
using SignalRC.Shared.Audio;
using SignalRC.Shared.Channels;
using SignalRC.Shared.FileTransfer;
using SignalRC.Shared.Flow;
using SignalRC.Shared.Logs;
using SignalRC.Shared.Telemetry;
using SignalRC.Shared.Update;
using SignalRC.Shared.Video;



public interface IConnectionHubServer
{
    // Connection lifecycle (onboard → server, browser → server)
    // Legacy handshake of onboards without a device key: update mode only (Docs/VehicleKeyAuth.md).
    Task<CarConfiguration> OpenCarConnection(string carIdentityKey, string channelMapHash);
    // Signed handshake: nonce for this connection, then the hello signed with the device key.
    Task<string> GetVehicleNonce();
    Task<CarConfiguration> OpenVehicleConnection(SignalRC.Shared.Security.VehicleHello hello);
    // The owner public key (ssh_key.pub, Base64 SPKI); only from a signed-in vehicle.
    Task ReportOwnerPublicKey(string ownerPublicKey);
    Task ReportOnboardVersion(string branch, string? commit);
    Task RegisterAvailableChannelTypes(int carId, AvailableChannelTypes types);
    // The car follows from the calling onboard connection.
    Task ReportChannelHealth(ChannelHealthReport report);
    // Batches of the onboard log; the car follows from the calling onboard connection.
    Task SendOnboardLogs(OnboardLogEntry[] entries);
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
    // Telemetry v1.1 (overlay): the car follows from the calling onboard connection.
    Task UpdateTelemetrySamples(TelemetryDelta delta);
    Task SubscribeToCarTelemetry(string carId);
    Task UnsubscribeFromCarTelemetry(string carId);
    Task RegisterAsOnboard(string carId);
    Task SubscribeToChannel(string carId, string channelName);
    Task UnsubscribeFromChannel(string carId, string channelName);

    // Video streams (onboard + browser → server; formerly ICarVideoServer)
    Task ConnectCar(string carIdentityKey);
    Task<IReadOnlyList<VideoStreamMapItem>> GetVideoStreamsForCar(int carId);
    Task ChangeVideoStreamSettings(int streamId, VideoStreamMapItem settings);
    Task SetVideoStreamEnabled(int carId, int streamId, bool enabled);

    // Listening (browser → server): the car's microphone runs on its own Janus audio mountpoint while
    // at least one browser listens. Returns the mountpoint id, or null if the car has no microphone.
    Task<int?> StartAudioListening(int carId);
    Task StopAudioListening(int carId);

    // Audio status (onboard → server → browsers): levels and state a few times per second while audio
    // runs. Subscribing returns the last known status (null if none yet).
    Task ReportAudioStatus(AudioStatus status);
    Task<AudioStatus?> SubscribeToAudioStatus(int carId);
    Task UnsubscribeFromAudioStatus(int carId);

    // Sound library download (onboard → server): a piece of one of the calling car's sound files,
    // at most SoundFileInfo.MaxChunkBytes. Null if the file doesn't exist.
    Task<byte[]?> GetSoundFileChunk(string name, long offset, int length);

    // Speaker volume (browser → server → onboard), driver only. Persisted as the car's speaker volume
    // and applied live. Returns the stored value.
    Task<float?> SetSpeakerVolume(int carId, float volume);

    // Push-to-talk (browser → server → onboard). Requires the control session id.
    Task<bool> StartAudioTalk(int carId, string sessionId, string format);
    Task SendAudioChunk(int carId, string sessionId, byte[] chunk);
    Task StopAudioTalk(int carId, string sessionId);

    // Diagnostics (browser → server → onboard)
    Task<OnboardDiagnosticsReport> GetOnboardDiagnostics(int carId);
    Task<OnboardDiagnosticsReport> RunOnboardStartupTest(int carId);

    // Self-update (Docs/OnboardAutoUpdate.md)
    // The car follows from the calling onboard connection.
    Task ReportOnboardUpdateStatus(OnboardUpdateStatus status);
    // Browser → server → onboard. Requires the control session id.
    Task<OnboardUpdateRequestResult> RequestOnboardUpdate(int carId, string sessionId);

    // Onboard flow (OnboardFlow-Arbeitspakete.md OF00)
    // Onboard → server: the car follows from the calling onboard connection.
    Task ReportOnboardFlowStatus(OnboardFlowStatus status);
    Task ReportVehicleInputDevices(VehicleInputDeviceInfo[] devices);
    // Browser → server → onboard. Require the control session id.
    Task UpdateFlowHandoff(int carId, string sessionId, int nodeId, decimal value);
    Task<bool> SetWebDetached(int carId, string sessionId, bool detached);
    Task<BluetoothResult> VehicleBluetooth(int carId, string sessionId, string action, string? address);
    // Browser: status of the car's onboard flow; returns the last known one.
    Task<OnboardFlowStatus?> SubscribeToFlowStatus(int carId);
    Task UnsubscribeFromFlowStatus(int carId);
    // Browser (flow editor): the node values of the onboard flow, only while subscribed.
    Task SubscribeToFlowValues(int carId);
    Task UnsubscribeFromFlowValues(int carId);
}
