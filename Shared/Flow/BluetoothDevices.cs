using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Flow;

/// <summary>A Bluetooth device the vehicle sees or knows (OF08).</summary>
[MessagePackObject]
public class BluetoothDeviceInfo
{
    [Key(0)][JsonPropertyName("address")] public string Address { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [Key(2)][JsonPropertyName("paired")] public bool Paired { get; set; }
    [Key(3)][JsonPropertyName("trusted")] public bool Trusted { get; set; }
    [Key(4)][JsonPropertyName("connected")] public bool Connected { get; set; }
}

/// <summary>Result of a Bluetooth action on the vehicle.</summary>
[MessagePackObject]
public class BluetoothResult
{
    [Key(0)][JsonPropertyName("success")] public bool Success { get; set; }
    [Key(1)][JsonPropertyName("message")] public string? Message { get; set; }
    [Key(2)][JsonPropertyName("devices")] public List<BluetoothDeviceInfo> Devices { get; set; } = new();
}

/// <summary>Bluetooth actions the browser can request (T14).</summary>
public static class BluetoothAction
{
    /// <summary>Known and nearby devices without scanning.</summary>
    public const string List = "list";
    /// <summary>Scan for about 10 s, then list.</summary>
    public const string Scan = "scan";
    /// <summary>Pair, trust and connect.</summary>
    public const string Pair = "pair";
    public const string Connect = "connect";
    public const string Disconnect = "disconnect";
    /// <summary>Unpair and forget.</summary>
    public const string Remove = "remove";
}
