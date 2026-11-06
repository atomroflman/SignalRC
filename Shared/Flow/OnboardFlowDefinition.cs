using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Flow;

/// <summary>Zone of a flow node (OnboardFlow-Arbeitspakete.md T01).</summary>
public enum FlowZone
{
    /// <summary>Runs in the driver's browser (all flows before the onboard flow).</summary>
    Browser = 0,
    /// <summary>Runs on the vehicle.</summary>
    Onboard = 1,
}

/// <summary>Node kinds of an onboard flow.</summary>
public static class OnboardFlowNodeKind
{
    /// <summary>A filter function (Abs, Gearbox, Smooth …).</summary>
    public const string Function = "function";
    /// <summary>Value handed over by the browser flow; outputs value and connected.</summary>
    public const string Handoff = "handoff";
    /// <summary>An axis or button of a controller connected to the vehicle; outputs value and connected.</summary>
    public const string VehicleInput = "vehicleInput";
    /// <summary>A vehicle control channel driven by the onboard flow.</summary>
    public const string Output = "output";
}

/// <summary>
/// The onboard part of a user's flow, pushed by the server as one snapshot (T06).
/// Only nodes of the Onboard zone and the links between them.
/// </summary>
[MessagePackObject]
public class OnboardFlowDefinition
{
    /// <summary>SHA-256 (hex) over the canonical content, without the hash itself.</summary>
    [Key(0)][JsonPropertyName("hash")] public string Hash { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("setupId")] public int SetupId { get; set; }
    [Key(2)][JsonPropertyName("userId")] public int UserId { get; set; }
    [Key(3)][JsonPropertyName("nodes")] public List<OnboardFlowNode> Nodes { get; set; } = new();
    [Key(4)][JsonPropertyName("links")] public List<OnboardFlowLink> Links { get; set; } = new();
}

[MessagePackObject]
public class OnboardFlowNode
{
    /// <summary>The server's node id; stable across pushes so node state survives (E09).</summary>
    [Key(0)][JsonPropertyName("id")] public int Id { get; set; }
    /// <summary>One of <see cref="OnboardFlowNodeKind"/>.</summary>
    [Key(1)][JsonPropertyName("kind")] public string Kind { get; set; } = OnboardFlowNodeKind.Function;
    /// <summary>Function name for <see cref="OnboardFlowNodeKind.Function"/>.</summary>
    [Key(2)][JsonPropertyName("function")] public string? Function { get; set; }
    /// <summary>Function parameters as stored (text).</summary>
    [Key(3)][JsonPropertyName("params")] public Dictionary<string, string?> Params { get; set; } = new();
    /// <summary>Control channel name (ChannelMap key) for <see cref="OnboardFlowNodeKind.Output"/>.</summary>
    [Key(4)][JsonPropertyName("channelName")] public string? ChannelName { get; set; }
    /// <summary>Resend interval of the output channel in ms, null = default.</summary>
    [Key(5)][JsonPropertyName("resendIntervalMs")] public int? ResendIntervalMs { get; set; }
    /// <summary>Device key of a vehicle input (see VehicleInputDeviceInfo.Key).</summary>
    [Key(6)][JsonPropertyName("inputDeviceKey")] public string? InputDeviceKey { get; set; }
    /// <summary>evdev code of a vehicle input (ABS_* or BTN_*/KEY_*).</summary>
    [Key(7)][JsonPropertyName("inputCode")] public int InputCode { get; set; }
    [Key(8)][JsonPropertyName("isAxis")] public bool IsAxis { get; set; }
    /// <summary>Display label, for logs and status only.</summary>
    [Key(9)][JsonPropertyName("label")] public string? Label { get; set; }
}

[MessagePackObject]
public class OnboardFlowLink
{
    [Key(0)][JsonPropertyName("from")] public int From { get; set; }
    [Key(1)][JsonPropertyName("fromPort")] public string? FromPort { get; set; }
    [Key(2)][JsonPropertyName("to")] public int To { get; set; }
    [Key(3)][JsonPropertyName("toPort")] public string? ToPort { get; set; }
}
