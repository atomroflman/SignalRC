using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Audio;

/// <summary>
/// Live audio state of a vehicle, reported by the Onboard a few times per second while its microphone
/// uplink or speaker output runs (plus one final report when both stop). The server relays it to
/// subscribed browsers for level meters and the speaker volume slider.
/// </summary>
[MessagePackObject]
public class AudioStatus
{
    /// <summary>Microphone is being captured and sent.</summary>
    [Key(0)][JsonPropertyName("uplinkRunning")] public bool UplinkRunning { get; set; }

    /// <summary>Microphone peak (dBFS, after gain) since the last report; null = silence or off.</summary>
    [Key(1)][JsonPropertyName("inputLevelDb")] public float? InputLevelDb { get; set; }

    /// <summary>Microphone is muted because push-to-talk plays.</summary>
    [Key(2)][JsonPropertyName("inputMuted")] public bool InputMuted { get; set; }

    /// <summary>Speaker device is open.</summary>
    [Key(3)][JsonPropertyName("outputOpen")] public bool OutputOpen { get; set; }

    /// <summary>Speaker peak (dBFS, after volume) since the last report; null = silence or off.</summary>
    [Key(4)][JsonPropertyName("outputLevelDb")] public float? OutputLevelDb { get; set; }

    /// <summary>Push-to-talk is playing.</summary>
    [Key(5)][JsonPropertyName("talking")] public bool Talking { get; set; }

    /// <summary>Speaker master volume currently applied.</summary>
    [Key(6)][JsonPropertyName("outputVolume")] public float OutputVolume { get; set; } = 1f;

    /// <summary>Names of the sound channels currently playing.</summary>
    [Key(7)][JsonPropertyName("sounds")] public string[] Sounds { get; set; } = Array.Empty<string>();
}
