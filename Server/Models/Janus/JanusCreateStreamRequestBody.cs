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
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? VideoPort { get; set; }
    [JsonPropertyName("videopt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? VideoPt { get; set; } = 96;
    [JsonPropertyName("videocodec")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Videocodec { get; set; } = "h264";
    [JsonPropertyName("audioport")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? AudioPort { get; set; }
    [JsonPropertyName("audiopt")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? AudioPt { get; set; }
    // Janus 1.x reads "audiocodec", 0.x needs "audiortpmap"; sending both keeps either version happy.
    [JsonPropertyName("audiocodec")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Audiocodec { get; set; }
    [JsonPropertyName("audiortpmap")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? AudioRtpMap { get; set; }
    [JsonPropertyName("secret")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Secret { get; set; }
}
