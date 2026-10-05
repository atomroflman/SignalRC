namespace SignalRC.Shared.HubClients;

// ponytail: subset of the merged hub's client interface used by the Onboard's
// AudioService. See ITelemetryClient for the dispatch-by-method-name rationale.
public interface IAudioClient
{
    /// <summary>
    /// Starts sending the microphone configured on video stream <paramref name="streamId"/>
    /// (VideoStreamMapItem.AudioDevice) as Opus/RTP to the Janus audio port of that stream's mountpoint.
    /// Sent alongside StartVideoStream; anyone watching the stream hears it.
    /// </summary>
    Task StartAudioUplink(string streamId, int port);

    Task StopAudioUplink(string streamId);

    /// <summary>
    /// Prepares the vehicle speaker for a push-to-talk burst. Only the active control session may talk.
    /// <paramref name="format"/> is the container the browser records into ("webm" or "ogg", Opus inside),
    /// <paramref name="outputDevice"/> the ALSA playback device configured for the car.
    /// </summary>
    Task<bool> StartAudioPlayback(string sessionId, string format, string outputDevice);

    /// <summary>
    /// One chunk of the recorded container stream, in recording order.
    /// </summary>
    Task PlayAudioChunk(string sessionId, byte[] chunk);

    Task StopAudioPlayback(string sessionId);
}
