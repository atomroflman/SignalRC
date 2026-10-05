using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Channels;

// ponytail: vehicle-reported list of every ControlType string and every
// telemetry reader class name the Onboard knows about. Browser fetches
// this to populate the channel-config autocomplete, so the UI can only
// suggest types the running Onboard build actually supports.
[MessagePackObject]
public class AvailableChannelTypes
{
    [Key(0)][JsonPropertyName("controlTypes")] public string[] ControlTypes { get; set; } = Array.Empty<string>();
    [Key(1)][JsonPropertyName("telemetryTypes")] public string[] TelemetryTypes { get; set; } = Array.Empty<string>();
    // ALSA devices as listed by `arecord -L` / `aplay -L` at connect time.
    [Key(2)][JsonPropertyName("audioInputDevices")] public AudioDeviceInfo[] AudioInputDevices { get; set; } = Array.Empty<AudioDeviceInfo>();
    [Key(3)][JsonPropertyName("audioOutputDevices")] public AudioDeviceInfo[] AudioOutputDevices { get; set; } = Array.Empty<AudioDeviceInfo>();
}

[MessagePackObject]
public class AudioDeviceInfo
{
    [Key(0)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("description")] public string? Description { get; set; }
}
