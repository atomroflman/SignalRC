using System.Text.Json.Serialization;

public class JanusMessageResponse<TBody> : JanusResponseBase
{
    [JsonPropertyName("body")]
    public TBody Body { get; set; } = default!;
}   

public class JanusPluginMessageResponse<TBody> : JanusResponseBase
{
    [JsonPropertyName("plugindata")]
    public TBody Body { get; set; } = default!;
}   

public class JanusPluginMessageListResponseBody
{
    [JsonPropertyName("plugin")]
    public string Plugin { get; set; } = string.Empty;
    [JsonPropertyName("list")]
    public List<JanusStreamInfo> Streams { get; set; } = new();
}

public class JanusStreamInfo
{
    [JsonPropertyName("id")]
    public uint Id { get; set; }
    [JsonPropertyName("description")]
    public string Description { get; set; } = string.Empty;
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }
    [JsonPropertyName("media")]
    public List<JanusStreamMediaInfo> Media { get; set; } = new();
}

public class JanusStreamMediaInfo
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;
    [JsonPropertyName("label")]
    public string Label { get; set; } = string.Empty;
    [JsonPropertyName("age_ms")]
    public int AgeMs { get; set; }
    public override string ToString()
    {
        return $"{Type} ({Label}), age {TimeSpan.FromMilliseconds(AgeMs)}";
    }
}