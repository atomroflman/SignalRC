using System.Text.Json.Serialization;

namespace LteCar.Shared.SetupTemplate;

public sealed class VehicleSetupTemplate
{
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;
    [JsonPropertyName("name")]
    public string? Name { get; set; }
    [JsonPropertyName("description")]
    public string? Description { get; set; }
    [JsonPropertyName("exportedAt")]
    public DateTime ExportedAt { get; set; } = DateTime.UtcNow;
    [JsonPropertyName("channels")]
    public TemplateChannels Channels { get; set; } = new();
    [JsonPropertyName("flow")]
    public TemplateFlow Flow { get; set; } = new();
    [JsonPropertyName("telemetrySubscriptions")]
    public List<TemplateTelemetrySubscription> TelemetrySubscriptions { get; set; } = new();
}

public sealed class TemplateChannels
{
    [JsonPropertyName("control")]
    public List<TemplateControlChannel> Control { get; set; } = new();
    [JsonPropertyName("telemetry")]
    public List<TemplateTelemetryChannel> Telemetry { get; set; } = new();
    [JsonPropertyName("video")]
    public List<TemplateVideoStream> Video { get; set; } = new();
}

public sealed class TemplateControlChannel
{
    [JsonPropertyName("channelName")] public string ChannelName { get; set; } = "";
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
    [JsonPropertyName("isEnabled")] public bool IsEnabled { get; set; } = true;
    [JsonPropertyName("requiresAxis")] public bool RequiresAxis { get; set; }
    [JsonPropertyName("maxResendInterval")] public int? MaxResendInterval { get; set; }
}

public sealed class TemplateTelemetryChannel
{
    [JsonPropertyName("channelName")] public string ChannelName { get; set; } = "";
    [JsonPropertyName("telemetryType")] public string? TelemetryType { get; set; }
    [JsonPropertyName("dataType")] public string? DataType { get; set; }
    [JsonPropertyName("unit")] public string? Unit { get; set; }
    [JsonPropertyName("decimals")] public byte? Decimals { get; set; }
    [JsonPropertyName("readIntervalTicks")] public int ReadIntervalTicks { get; set; }
}

public sealed class TemplateVideoStream
{
    [JsonPropertyName("streamId")] public string StreamId { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "camera";
    [JsonPropertyName("location")] public string? Location { get; set; }
    [JsonPropertyName("priority")] public int Priority { get; set; } = 1;
    [JsonPropertyName("enabled")] public bool Enabled { get; set; } = true;
    [JsonPropertyName("protocol")] public string Protocol { get; set; } = "tcp";
    [JsonPropertyName("port")] public int Port { get; set; }
    [JsonPropertyName("janusPort")] public int? JanusPort { get; set; }
    [JsonPropertyName("janusId")] public string? JanusId { get; set; }
    [JsonPropertyName("height")] public int Height { get; set; } = 720;
    [JsonPropertyName("width")] public int Width { get; set; } = 1280;
    [JsonPropertyName("bitrateKbps")] public int BitrateKbps { get; set; } = 1500;
    [JsonPropertyName("framerate")] public int Framerate { get; set; } = 30;
    [JsonPropertyName("brightness")] public float Brightness { get; set; } = 0.5f;
    [JsonPropertyName("processArguments")] public string? ProcessArguments { get; set; }
    [JsonPropertyName("streamPurpose")] public string? StreamPurpose { get; set; }
}

public sealed class TemplateFlow
{
    [JsonPropertyName("nodes")] public List<TemplateFlowNode> Nodes { get; set; } = new();
    [JsonPropertyName("edges")] public List<TemplateFlowEdge> Edges { get; set; } = new();
}

public sealed class TemplateFlowNode
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("positionX")] public float PositionX { get; set; }
    [JsonPropertyName("positionY")] public float PositionY { get; set; }
    [JsonPropertyName("binding")] public ControllerBinding? Binding { get; set; }
    [JsonPropertyName("channelName")] public string? ChannelName { get; set; }
    [JsonPropertyName("functionName")] public string? FunctionName { get; set; }
    [JsonPropertyName("params")] public Dictionary<string, string?>? Parameters { get; set; }
}

public sealed class ControllerBinding
{
    [JsonPropertyName("deviceName")] public string DeviceName { get; set; } = "";
    [JsonPropertyName("channelName")] public string ChannelName { get; set; } = "";
    [JsonPropertyName("isAxis")] public bool IsAxis { get; set; }
}

public sealed class TemplateFlowEdge
{
    [JsonPropertyName("fromNode")] public string FromNode { get; set; } = "";
    [JsonPropertyName("fromPort")] public string? FromPort { get; set; }
    [JsonPropertyName("toNode")] public string ToNode { get; set; } = "";
    [JsonPropertyName("toPort")] public string? ToPort { get; set; }
}

public sealed class TemplateTelemetrySubscription
{
    [JsonPropertyName("channelName")] public string ChannelName { get; set; } = "";
    [JsonPropertyName("order")] public int Order { get; set; }
}

public sealed class TemplateImportRequest
{
    [JsonPropertyName("template")] public VehicleSetupTemplate Template { get; set; } = new();
    [JsonPropertyName("controllerBindings")] public Dictionary<string, ControllerBinding> ControllerBindings { get; set; } = new();
}

public sealed class TemplateImportResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; } = true;
    [JsonPropertyName("warnings")] public List<string> Warnings { get; set; } = new();
    [JsonPropertyName("nodesCreated")] public int NodesCreated { get; set; }
    [JsonPropertyName("edgesCreated")] public int EdgesCreated { get; set; }
    [JsonPropertyName("telemetrySubscribed")] public int TelemetrySubscribed { get; set; }
}