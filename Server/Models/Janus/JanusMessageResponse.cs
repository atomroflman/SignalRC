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

/// <summary>The plugindata envelope: the plugin's actual reply sits under "data".</summary>
public class JanusPluginData<TData>
{
    [JsonPropertyName("plugin")]
    public string Plugin { get; set; } = string.Empty;
    [JsonPropertyName("data")]
    public TData Data { get; set; } = default!;
}

/// <summary>Common part of every streaming-plugin reply; a failed request is still "janus": "success".</summary>
public class JanusPluginResult
{
    [JsonPropertyName("error_code")]
    public int? ErrorCode { get; set; }
    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

public class JanusPluginMessageListResponseBody : JanusPluginResult
{
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