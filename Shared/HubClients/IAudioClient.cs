namespace SignalRC.Shared.HubClients;

// ponytail: subset of the merged hub's client interface used by the Onboard's
// AudioService. See ITelemetryClient for the dispatch-by-method-name rationale.
// Every call carries the control session id; the Onboard rejects anything that
// doesn't match the active session, so only the current driver can open the
// vehicle microphone or speak through its speaker.
public interface IAudioClient
{
    /// <summary>
    /// Starts sending the vehicle microphone as Opus/RTP to the Janus port on the server.
    /// Idempotent: restarts the sender if the port changed.
    /// </summary>
    Task<bool> StartAudioUplink(string sessionId, int port);

    /// <summary>
    /// Stops the microphone uplink. Sent by the server when the last listener leaves.
    /// </summary>
    Task StopAudioUplink();

    /// <summary>
    /// Prepares the vehicle speaker for a push-to-talk burst. <paramref name="format"/> is the
    /// container the browser records into ("webm" or "ogg", Opus inside).
    /// </summary>
    Task<bool> StartAudioPlayback(string sessionId, string format);

    /// <summary>
    /// One chunk of the recorded container stream, in recording order.
    /// </summary>
    Task PlayAudioChunk(string sessionId, byte[] chunk);

    Task StopAudioPlayback(string sessionId);
}
