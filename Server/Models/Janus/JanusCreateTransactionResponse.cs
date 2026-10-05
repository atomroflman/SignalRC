using System.Text.Json.Serialization;

public class JanusCreateTransactionResponse : JanusResponseBase
{
    [JsonPropertyName("data")]
    public JanusCreateTransactionData Data { get; set; } = null!;
}

public class JanusCreateTransactionData
{
    [JsonPropertyName("id")]
    public long Id { get; set; }
}