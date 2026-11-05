namespace SignalRC.Server.Data;

/// <summary>
/// One drive of a vehicle: from the onboard connecting until it disconnects. A
/// reconnect within a short gap continues the same session (TelemetryRecorder).
/// </summary>
public class TelemetrySession : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;

    public DateTime StartedAt { get; set; }
    /// <summary>Null while the onboard is connected.</summary>
    public DateTime? EndedAt { get; set; }
    /// <summary>Time of the newest stored sample; null as long as nothing was recorded.</summary>
    public DateTime? LastSampleAt { get; set; }

    /// <summary>
    /// The recorded channels as they were configured during the session
    /// (TelemetrySessionChannel[]), so renamed or deleted channels stay readable.
    /// </summary>
    public string ChannelsJson { get; set; } = "[]";

    public ICollection<TelemetryHistorySample> Samples { get; set; } = new List<TelemetryHistorySample>();
}

/// <summary>A recorded value; NaN marks a gap (no data, stale or error at the source).</summary>
public class TelemetryHistorySample
{
    public long Id { get; set; }
    public int SessionId { get; set; }
    public TelemetrySession Session { get; set; } = null!;
    /// <summary>CarTelemetry.Id at recording time.</summary>
    public int ChannelId { get; set; }
    /// <summary>Measurement time (server receive time minus the sample age), UTC.</summary>
    public DateTime Time { get; set; }
    public double Value { get; set; }
}

/// <summary>Charts and formulas of the telemetry dashboard of a vehicle, as the client stores them.</summary>
public class CarTelemetryDashboard : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
    public string LayoutJson { get; set; } = "{}";
    public DateTime ModifiedAt { get; set; } = DateTime.UtcNow;
}

/// <summary>Channel metadata stored with a session.</summary>
public sealed record TelemetrySessionChannel(int Id, string Name, SignalRC.Shared.Channels.TelemetryDataType DataType, string? Unit, byte? Decimals);
