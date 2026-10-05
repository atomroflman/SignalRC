using System.Text.Json.Serialization;

public class JanusMessageRequest<TBody> : JanusRequestBase
{
    [JsonPropertyName("body")]
    public TBody Body { get; set; } = default!;
}

public class JanusMessageBody
{
    [JsonPropertyName("request")]
    public string Request { get; set; } = string.Empty;
}

public class JanusMountpointActionBody
{
    [JsonPropertyName("request")]
    public string Request { get; set; } = string.Empty;
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public uint? Id { get; set; }
}