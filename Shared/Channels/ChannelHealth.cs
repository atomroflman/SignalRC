using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Channels;

/// <summary>
/// What the onboard made of its channel config: one entry per pin manager, control,
/// telemetry channel and video stream that is not plain OK. The onboard sends the
/// whole report whenever an entry changes and after every (re)connect; the server
/// keeps the latest one per connected car for the channel config page.
/// </summary>
[MessagePackObject]
public class ChannelHealthReport
{
    [Key(0)][JsonPropertyName("entries")] public ChannelHealthEntry[] Entries { get; set; } = Array.Empty<ChannelHealthEntry>();
    [Key(1)][JsonPropertyName("generatedAtUtc")] public DateTime GeneratedAtUtc { get; set; }
}

[MessagePackObject]
public class ChannelHealthEntry
{
    public const string Warning = "warning";
    public const string Error = "error";

    /// <summary>One of the <see cref="ChannelTypeSchema"/> kind constants.</summary>
    [Key(0)][JsonPropertyName("kind")] public string Kind { get; set; } = string.Empty;
    /// <summary>Channel name, stream id or pin manager name as in the ChannelMap.</summary>
    [Key(1)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    /// <summary><see cref="Warning"/>: runs, but not as configured. <see cref="Error"/>: does not run.</summary>
    [Key(2)][JsonPropertyName("state")] public string State { get; set; } = Error;
    [Key(3)][JsonPropertyName("message")] public string Message { get; set; } = string.Empty;
    [Key(4)][JsonPropertyName("sinceUtc")] public DateTime SinceUtc { get; set; }
}
