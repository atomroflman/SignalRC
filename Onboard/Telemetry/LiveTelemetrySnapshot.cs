using System.Collections.Concurrent;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// The latest sample of every telemetry channel as the readers delivered it, by channel
/// name. The onboard flow's Telemetry nodes read from here (E05), so a value reaches the
/// flow without the server round trip.
/// </summary>
public class LiveTelemetrySnapshot
{
    private readonly ConcurrentDictionary<string, (TelemetrySample Sample, long AtMs)> _values = new(StringComparer.Ordinal);

    /// <summary>A sample older than this counts as invalid, whatever its state said.</summary>
    public const int MaxAgeMs = 5000;

    public void Set(string channelName, TelemetrySample sample) => _values[channelName] = (sample, Environment.TickCount64);

    /// <summary>Value and validity like nodeValue in flow-telemetry.ts: valid and unchecked count, others do not.</summary>
    public (string Value, bool Valid)? Get(string channelName)
    {
        if (!_values.TryGetValue(channelName, out var entry)) return null;
        var fresh = Environment.TickCount64 - entry.AtMs <= MaxAgeMs;
        var valid = fresh && entry.Sample.State is TelemetrySampleState.Valid or TelemetrySampleState.Unchecked;
        return (entry.Sample.Value, valid);
    }
}
