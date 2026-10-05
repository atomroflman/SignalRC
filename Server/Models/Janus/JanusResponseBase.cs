using System.Text.Json.Serialization;

public abstract class JanusResponseBase
{
    [JsonPropertyName("janus")]
    public string Janus { get; set; } = string.Empty;
    [JsonPropertyName("transaction")]
    public string Transaction { get; set; } = string.Empty;
    public bool IsSuccess => Janus == "success";
    [JsonPropertyName("error")]
    public ErrorModel? Error { get; set; }
}

public class ErrorModel
{
    [JsonPropertyName("code")]
    public int Code { get; set; }
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = string.Empty;
}