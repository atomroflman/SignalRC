using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Flow;

/// <summary>A controller connected to the vehicle (evdev), as the onboard reports it (T12).</summary>
[MessagePackObject]
public class VehicleInputDeviceInfo
{
    /// <summary>Bluetooth address (evdev "uniq") or "vendor:product:name".</summary>
    [Key(0)][JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [Key(2)][JsonPropertyName("channels")] public List<VehicleInputChannelInfo> Channels { get; set; } = new();
}

[MessagePackObject]
public class VehicleInputChannelInfo
{
    /// <summary>evdev code: ABS_* for axes, BTN_*/KEY_* for buttons.</summary>
    [Key(0)][JsonPropertyName("code")] public int Code { get; set; }
    [Key(1)][JsonPropertyName("isAxis")] public bool IsAxis { get; set; }
    /// <summary>Readable name, e.g. "ABS_X" or "BTN_SOUTH".</summary>
    [Key(2)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
}
