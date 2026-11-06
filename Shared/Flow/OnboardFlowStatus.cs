using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Flow;

/// <summary>Operating mode of the onboard flow (T13).</summary>
public static class OnboardFlowMode
{
    /// <summary>No onboard flow loaded: browser → hardware as before.</summary>
    public const string Off = "off";
    /// <summary>Onboard flow runs, the web is attached (mixed operation, E12).</summary>
    public const string Mixed = "mixed";
    /// <summary>Onboard flow runs without the web (E13).</summary>
    public const string Detached = "detached";
}

/// <summary>State of the onboard flow, reported by the vehicle and relayed to the car's browsers.</summary>
[MessagePackObject]
public class OnboardFlowStatus
{
    /// <summary>Hash of the loaded definition, null without one.</summary>
    [Key(0)][JsonPropertyName("hash")] public string? Hash { get; set; }
    /// <summary>One of <see cref="OnboardFlowMode"/>.</summary>
    [Key(1)][JsonPropertyName("mode")] public string Mode { get; set; } = OnboardFlowMode.Off;
    /// <summary>Handoff values from the browser arrive.</summary>
    [Key(2)][JsonPropertyName("handoffConnected")] public bool HandoffConnected { get; set; }
    /// <summary>Controllers known to the vehicle right now.</summary>
    [Key(3)][JsonPropertyName("devices")] public List<VehicleInputDeviceState> Devices { get; set; } = new();
    // Key 4 held the first output per node until the status carried all outputs (Outputs).
    /// <summary>
    /// All outputs of every onboard node by node id, in the function's output order. Only
    /// filled while a flow editor of the vehicle is open (SetFlowValueDemand), so the values
    /// do not cost bandwidth while driving.
    /// </summary>
    [Key(7)][JsonPropertyName("outputs")] public Dictionary<int, double[]> Outputs { get; set; } = new();
    /// <summary>Control channels the onboard flow owns (ChannelMap names).</summary>
    [Key(5)][JsonPropertyName("ownedChannels")] public List<string> OwnedChannels { get; set; } = new();
    /// <summary>Setup whose flow is loaded, null without one.</summary>
    [Key(6)][JsonPropertyName("setupId")] public int? SetupId { get; set; }
}

[MessagePackObject]
public class VehicleInputDeviceState
{
    [Key(0)][JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [Key(2)][JsonPropertyName("connected")] public bool Connected { get; set; }
}
