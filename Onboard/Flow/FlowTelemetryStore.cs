using System.Collections.Concurrent;
using System.Diagnostics;

namespace SignalRC.Onboard.Flow;

/// <summary>
/// Values the onboard flow publishes with "Telemetrie senden" (TelemetryOut), by key. A
/// telemetry channel of type FlowValueReader with the same key sends them like any other
/// telemetry value (HUD, history, demand).
/// </summary>
public sealed class FlowTelemetryStore
{
    private readonly ConcurrentDictionary<string, (double Value, long AtMs)> _values = new(StringComparer.Ordinal);
    private readonly Stopwatch _clock = Stopwatch.StartNew();

    public long NowMs => _clock.ElapsedMilliseconds;

    public void Set(string key, double value) => _values[key] = (value, NowMs);

    /// <summary>Latest value and its age in ms, null if the flow never published the key.</summary>
    public (double Value, long AgeMs)? Get(string key) =>
        _values.TryGetValue(key, out var v) ? (v.Value, NowMs - v.AtMs) : null;
}
