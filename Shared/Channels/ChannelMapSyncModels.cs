using System.Text.Json.Serialization;
using MessagePack;

namespace LteCar.Shared.Channels;

// MessagePack keys chosen to keep bandwidth low; order stable for future evolution
[MessagePackObject]
public class ChannelMapSyncRequest
{
    [Key(0)][JsonPropertyName("carId")] public int CarId { get; set; }

    /// <summary>
    /// Kept for wire compatibility. Server-as-SPOT ignores the client's channel map;
    /// the response always contains the server's current configuration.
    /// </summary>
    [Key(1)][JsonPropertyName("channelMap")] public ChannelMap ChannelMap { get; set; } = new();
}

// Response with hash + id dictionaries
[MessagePackObject]
public class ChannelMapSyncResponse
{
    [Key(0)][JsonPropertyName("hash")] public string Hash { get; set; } = string.Empty;
    // Normalized channel map (may contain ordering / removed unused fields later) - for now we just echo back
    [Key(1)][JsonPropertyName("channelMap")] public ChannelMap ChannelMap { get; set; } = new();
    // Numeric ids assigned per logical name (sparse dictionaries kept small)
    [Key(2)][JsonPropertyName("controlIds")] public Dictionary<string,int> ControlIds { get; set; } = new();
    [Key(3)][JsonPropertyName("telemetryIds")] public Dictionary<string,int> TelemetryIds { get; set; } = new();
    [Key(4)][JsonPropertyName("videoIds")] public Dictionary<string,int> VideoIds { get; set; } = new();
    [Key(5)][JsonPropertyName("generatedAtUtc")] public DateTime GeneratedAtUtc { get; set; } = DateTime.UtcNow;
}
