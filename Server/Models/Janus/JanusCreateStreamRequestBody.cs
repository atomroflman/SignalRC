using System.Text.Json.Serialization;

public class JanusCreateStreamRequestBody
{
    [JsonPropertyName("request")]
    public string Request { get; set; } = "create";
    [JsonPropertyName("type")]
    public string Type { get; set; } = "rtp";
    [JsonPropertyName("id")]
    public uint Id { get; set; }
    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;
    [JsonPropertyName("audio")]
    public bool Audio { get; set; } = false;
    [JsonPropertyName("video")]
    public bool Video { get; set; } = true;
    [JsonPropertyName("videoport")]
    public int VideoPort { get; set; }
    [JsonPropertyName("videopt")]
    public int VideoPt { get; set; } = 96;
    [JsonPropertyName("videocodec")]
    public string Videocodec { get; set; } = "h264";
    [JsonPropertyName("secret")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Secret { get; set; }
}