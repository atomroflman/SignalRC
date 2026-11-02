using MessagePack;

namespace SignalRC.Shared.Telemetry;

// Wire format onboard → server (Shared/Overlay/telemetry/README.md §3, §4).
// MessagePack with integer keys keeps it compact; only changes carry values,
// unchanged channels are confirmed by id (D59–D61).

/// <summary>Source quality of a telemetry value.</summary>
public enum TelemetrySampleState : byte
{
    Valid = 0,
    Unchecked = 1,
    Stale = 2,
    Error = 3,
    NoData = 4,
}

/// <summary>A channel whose value or state changed, or is sent for the first time.</summary>
[MessagePackObject]
public class TelemetryChange
{
    /// <summary>CarTelemetry.Id (ServerId in the channel map).</summary>
    [Key(0)] public int Id { get; set; }
    [Key(1)] public string Value { get; set; } = string.Empty;
    [Key(2)] public TelemetrySampleState State { get; set; }
    /// <summary>Only set when it differs from the delta's default age.</summary>
    [Key(3)] public int? AgeMs { get; set; }
}

/// <summary>All telemetry of one onboard tick.</summary>
[MessagePackObject]
public class TelemetryDelta
{
    /// <summary>Random per onboard process start; a new epoch replaces the server cache.</summary>
    [Key(0)] public string Epoch { get; set; } = string.Empty;
    /// <summary>Strictly increasing within an epoch.</summary>
    [Key(1)] public long Seq { get; set; }
    /// <summary>Default measurement age: most frequent age of the tick, smallest on ties.</summary>
    [Key(2)] public int AgeMs { get; set; }
    [Key(3)] public List<TelemetryChange> Changed { get; set; } = [];
    /// <summary>Unchanged channels, age = AgeMs.</summary>
    [Key(4)] public int[] Touched { get; set; } = [];
    /// <summary>Unchanged channels with their own age, as flat pairs id, ageMs.</summary>
    [Key(5)] public int[] TouchedAged { get; set; } = [];

    public bool IsEmpty => Changed.Count == 0 && Touched.Length == 0 && TouchedAged.Length == 0;
}
