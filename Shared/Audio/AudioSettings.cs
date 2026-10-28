using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Audio;

/// <summary>
/// Car-level audio configuration: one microphone (listening) and one speaker (push-to-talk, sound
/// channels). Edited on the vehicle config page, stored on the server and pushed to the Onboard on
/// connect and on every change.
/// </summary>
[MessagePackObject]
public class AudioSettings
{
    public const string ChannelMix = "mix";
    public const string ChannelLeft = "left";
    public const string ChannelRight = "right";

    public const float MaxInputGain = 4f;
    public const float MaxOutputVolume = 2f;
    public const int MinBitrateKbps = 8;
    public const int MaxBitrateKbps = 128;

    /// <summary>ALSA capture device of the vehicle microphone; null = listening is off.</summary>
    [Key(0)][JsonPropertyName("inputDevice")] public string? InputDevice { get; set; }

    /// <summary>"mix" downmixes all capture channels, "left"/"right" use one side of a stereo sound card.</summary>
    [Key(1)][JsonPropertyName("inputChannel")] public string InputChannel { get; set; } = ChannelMix;

    /// <summary>Microphone gain, 1 = unchanged.</summary>
    [Key(2)][JsonPropertyName("inputGain")] public float InputGain { get; set; } = 1f;

    /// <summary>Highpass + FFT denoiser against wind and steady motor noise.</summary>
    [Key(3)][JsonPropertyName("denoise")] public bool Denoise { get; set; }

    /// <summary>Opus bitrate of the microphone uplink.</summary>
    [Key(4)][JsonPropertyName("bitrateKbps")] public int BitrateKbps { get; set; } = 32;

    /// <summary>ALSA playback device; null = no speaker (push-to-talk and sound channels are off).</summary>
    [Key(5)][JsonPropertyName("outputDevice")] public string? OutputDevice { get; set; }

    /// <summary>Speaker master volume, 1 = unchanged.</summary>
    [Key(6)][JsonPropertyName("outputVolume")] public float OutputVolume { get; set; } = 1f;

    /// <summary>Mutes the microphone while push-to-talk plays, so listeners don't hear the driver as echo.</summary>
    [Key(7)][JsonPropertyName("muteInputWhileTalking")] public bool MuteInputWhileTalking { get; set; } = true;

    /// <summary>Copy with blank devices nulled and every value clamped to its valid range.</summary>
    public AudioSettings Normalized() => new()
    {
        InputDevice = string.IsNullOrWhiteSpace(InputDevice) ? null : InputDevice.Trim(),
        InputChannel = InputChannel is ChannelLeft or ChannelRight ? InputChannel : ChannelMix,
        InputGain = float.IsFinite(InputGain) ? Math.Clamp(InputGain, 0f, MaxInputGain) : 1f,
        Denoise = Denoise,
        BitrateKbps = Math.Clamp(BitrateKbps, MinBitrateKbps, MaxBitrateKbps),
        OutputDevice = string.IsNullOrWhiteSpace(OutputDevice) ? null : OutputDevice.Trim(),
        OutputVolume = float.IsFinite(OutputVolume) ? Math.Clamp(OutputVolume, 0f, MaxOutputVolume) : 1f,
        MuteInputWhileTalking = MuteInputWhileTalking,
    };
}
