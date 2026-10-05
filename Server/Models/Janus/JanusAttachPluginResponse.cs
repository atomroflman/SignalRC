using System.Text.Json.Serialization;

public class JanusAttachPluginResponse : JanusResponseBase
{
    [JsonPropertyName("data")]
    public JanusAttachPluginData Data { get; set; } = null!;
}

public class JanusAttachPluginData
{
    [JsonPropertyName("id")]
    public long Id { get; set; }
}