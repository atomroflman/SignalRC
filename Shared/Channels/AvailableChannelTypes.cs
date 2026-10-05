using System.Text.Json.Serialization;
using MessagePack;

namespace LteCar.Shared.Channels;

// ponytail: vehicle-reported list of every ControlType string and every
// telemetry reader class name the Onboard knows about. Browser fetches
// this to populate the channel-config autocomplete, so the UI can only
// suggest types the running Onboard build actually supports.
[MessagePackObject]
public class AvailableChannelTypes
{
    [Key(0)][JsonPropertyName("controlTypes")] public string[] ControlTypes { get; set; } = Array.Empty<string>();
    [Key(1)][JsonPropertyName("telemetryTypes")] public string[] TelemetryTypes { get; set; } = Array.Empty<string>();
}
