namespace SignalRC.Onboard.Audio;

/// <summary>
/// Something the <see cref="AudioMixer"/> plays on the speaker (push-to-talk, a sound channel).
/// </summary>
public interface IMixerSource
{
    /// <summary>Name shown in the audio status (sound channel name), or null.</summary>
    string? Name { get; }

    /// <summary>
    /// Adds the next 20 ms (<see cref="AudioFormat.OutputFrameValues"/> interleaved stereo values) into
    /// <paramref name="mix"/>. Called from the mixer thread. Returns false once the source is finished;
    /// it is removed then.
    /// </summary>
    bool MixInto(Span<float> mix);

    /// <summary>Ends the source right away (output failed, device changed to none, …).</summary>
    void Abort();
}
