using SignalRC.Shared.Audio;
using SignalRC.Shared.Video;

namespace SignalRC.Shared.HubClients;

// ponytail: subset of the merged hub's client interface used by the Onboard's
// AudioService. See ITelemetryClient for the dispatch-by-method-name rationale.
public interface IAudioClient
{
    /// <summary>
    /// Car-level audio configuration, pushed on every (re)connect and whenever it changes in the UI.
    /// A running uplink or playback adapts to it.
    /// </summary>
    Task ApplyAudioSettings(AudioSettings settings);

    /// <summary>
    /// Starts sending the vehicle microphone (<see cref="AudioSettings.InputDevice"/>) as Opus/RTP to
    /// <paramref name="port"/> of the car's Janus audio mountpoint. Sent while at least one browser listens.
    /// </summary>
    Task StartAudioUplink(int port);

    Task StopAudioUplink();

    /// <summary>
    /// Prepares the vehicle speaker for a push-to-talk burst. Only the active control session may talk.
    /// <paramref name="format"/> is the container the browser records into ("webm" or "ogg", Opus inside).
    /// </summary>
    Task<bool> StartAudioPlayback(string sessionId, string format);

    /// <summary>
    /// One chunk of the recorded container stream, in recording order.
    /// </summary>
    Task PlayAudioChunk(string sessionId, byte[] chunk);

    Task StopAudioPlayback(string sessionId);

    /// <summary>
    /// Audio checks appended to the onboard diagnostics: ffmpeg/ALSA tooling, permissions, and a short
    /// open test of the configured microphone and speaker.
    /// </summary>
    Task<DiagnosticCheck[]> GetAudioDiagnostics();

    /// <summary>The ALSA devices the vehicle sees right now, for the device picker of the setup page.</summary>
    Task<AudioDeviceScan> ListAudioDevices();

    /// <summary>
    /// Tests one device before it is saved: records two seconds and reports the level, or plays a short
    /// tone when <paramref name="output"/> is set. Refuses while that device is in use.
    /// </summary>
    Task<AudioDeviceTestResult> TestAudioDevice(string device, bool output);

    /// <summary>
    /// The car's sound library, pushed on connect and after every upload/delete. The Onboard downloads
    /// missing or changed files (GetSoundFileChunk) and removes the ones no longer listed.
    /// </summary>
    Task SyncSoundFiles(SoundFileInfo[] files);

    /// <summary>
    /// Browser-only broadcast (relayed <see cref="AudioStatus"/>); the Onboard ignores it.
    /// </summary>
    Task AudioStatusUpdated(int carId, AudioStatus status);
}
