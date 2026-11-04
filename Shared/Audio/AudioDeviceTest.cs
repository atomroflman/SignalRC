using System.Text.Json.Serialization;
using MessagePack;
using SignalRC.Shared.Channels;

namespace SignalRC.Shared.Audio;

/// <summary>ALSA devices the vehicle sees right now; read live, so a USB sound card plugged in later shows up.</summary>
[MessagePackObject]
public class AudioDeviceScan
{
    [Key(0)][JsonPropertyName("inputs")] public AudioDeviceInfo[] Inputs { get; set; } = Array.Empty<AudioDeviceInfo>();
    [Key(1)][JsonPropertyName("outputs")] public AudioDeviceInfo[] Outputs { get; set; } = Array.Empty<AudioDeviceInfo>();
}

/// <summary>Outcome of a short test of one device: a recording with its level, or a tone on a speaker.</summary>
[MessagePackObject]
public class AudioDeviceTestResult
{
    [Key(0)][JsonPropertyName("ok")] public bool Ok { get; set; }
    [Key(1)][JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    /// <summary>Loudest sample in dBFS; null without a recording or on digital silence.</summary>
    [Key(2)][JsonPropertyName("peakDb")] public double? PeakDb { get; set; }
    /// <summary>Average level in dBFS; null without a recording or on digital silence.</summary>
    [Key(3)][JsonPropertyName("rmsDb")] public double? RmsDb { get; set; }
}
