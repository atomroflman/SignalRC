using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Logs;

/// <summary>
/// One onboard log line, forwarded to the server so the GUI can show the vehicle's log
/// without SSH. <see cref="Seq"/> is assigned by the server on receipt and is 0 on the wire.
/// </summary>
[MessagePackObject]
public class OnboardLogEntry
{
    [Key(0)][JsonPropertyName("seq")] public long Seq { get; set; }
    [Key(1)][JsonPropertyName("timestampUtc")] public DateTime TimestampUtc { get; set; }
    /// <summary>Microsoft.Extensions.Logging.LogLevel: 0 Trace … 5 Critical.</summary>
    [Key(2)][JsonPropertyName("level")] public int Level { get; set; }
    /// <summary>Logger category, usually the full class name.</summary>
    [Key(3)][JsonPropertyName("category")] public string Category { get; set; } = string.Empty;
    [Key(4)][JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [Key(5)][JsonPropertyName("exception")] public string? Exception { get; set; }
}
