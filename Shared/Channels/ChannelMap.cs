using System.Text.Json.Serialization;
using MessagePack;

namespace LteCar.Shared.Channels;

// MessagePack indexes chosen for stable, compact representation.
// Keep ordering stable; append new fields with next index.
[MessagePackObject]
public class ChannelMap
{
    [Key(0)]
    [JsonPropertyName("pinManagers")] 
    public Dictionary<string, PinManagerMapItem> PinManagers { get; set; } = new();
    [Key(1)]
    [JsonPropertyName("controlChannels")] 
    public Dictionary<string, ControlChannelMapItem> ControlChannels { get; set; } = new();
    [Key(2)]
    [JsonPropertyName("telemetryChannels")] 
    public Dictionary<string, TelemetryChannelMapItem> TelemetryChannels { get; set; } = new();
    [Key(3)]
    [JsonPropertyName("videoStreams")] 
    public Dictionary<string, VideoStreamMapItem> VideoStreams { get; set; } = new();
}

[MessagePackObject]
public class PinManagerMapItem
{
    [Key(0)][JsonPropertyName("type")] public string? Type { get; set; }
    [Key(1)][JsonPropertyName("options")] public Dictionary<string, object> Options { get; set; } = new();
}