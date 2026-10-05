using System.Text.Json.Serialization;
using MessagePack;

namespace LteCar.Shared.Channels;

// Base channel map item. Derived classes extend with their own keyed fields.
[MessagePackObject]
public class ChannelMapItem
{
    [Key(0)]
    [JsonPropertyName("pinManager")]
    public string PinManager { get; set; } = "default";
    [Key(1)]
    [JsonPropertyName("address")]
    public int? Address { get; set; }
    [Key(2)]
    [JsonPropertyName("options")]
    public Dictionary<string, object> Options { get; set; } = new();
    // Server-assigned numeric id (for compact messaging). Null until first sync.
    [Key(3)]
    [JsonPropertyName("serverId")]
    public int? ServerId { get; set; }
    // UTC timestamp of last modification. Used for last-write-wins sync.
    [Key(4)]
    [JsonPropertyName("modifiedAt")]
    public DateTime? ModifiedAt { get; set; }
}

[MessagePackObject]
public class ControlChannelMapItem : ChannelMapItem
{
    [Key(10)]
    [JsonPropertyName("controlType")] 
    public string ControlType { get; set; } = string.Empty;
    [Key(11)]
    [JsonPropertyName("testDisabled")] 
    public bool TestDisabled { get; set; }

    [JsonPropertyName("maxResendInterval")]
    [Key(12)]
    public int? MaxResendInterval { get; set; }
}

[MessagePackObject]
public class TelemetryChannelMapItem : ChannelMapItem
{
    [Key(12)][JsonPropertyName("readIntervalTicks")] public int ReadIntervalTicks { get; set; }
    [Key(13)][JsonPropertyName("telemetryType")] public string TelemetryType { get; set; } = string.Empty;
    [Key(14)][JsonPropertyName("dataType")] public TelemetryDataType DataType { get; set; } = TelemetryDataType.String;
    [Key(15)][JsonPropertyName("unit")] public string? Unit { get; set; }
    [Key(16)][JsonPropertyName("decimals")] public byte? Decimals { get; set; }
}



