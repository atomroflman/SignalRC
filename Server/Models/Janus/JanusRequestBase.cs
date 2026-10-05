using System.Text.Json.Serialization;

public class JanusRequestBase
{
    [JsonPropertyName("janus")]
    public string Janus { get; set; } = string.Empty;
    [JsonPropertyName("transaction")]
    public string Transaction { get; set; } = string.Empty;
}