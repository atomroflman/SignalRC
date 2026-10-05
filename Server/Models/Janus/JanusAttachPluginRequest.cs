using System.Text.Json.Serialization;

public class JanusAttachPluginRequest : JanusRequestBase
{
    [JsonPropertyName("plugin")]
    public string Plugin { get; set; } = string.Empty;
}