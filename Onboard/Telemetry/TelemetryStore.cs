using System.Collections.Concurrent;

namespace LteCar.Onboard.Telemetry;

// ponytail: shared bag the inbound ITelemetryClient.UpdateTelemetry writes
// into and StoreBackedTelemetryReader reads out of. The Onboard side has no
// other writable storage for inbound telemetry values, so this stays in
// process. Wipe when telemetry "restarts" — never persisted to disk.
public class TelemetryStore
{
    private readonly ConcurrentDictionary<string, string> _values = new(StringComparer.Ordinal);

    public void Set(string channelName, string value) => _values[channelName] = value;

    public string? Get(string channelName) =>
        _values.TryGetValue(channelName, out var v) ? v : null;
}
