using System.Globalization;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Flow;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// A value the vehicle flow publishes with "Telemetrie senden" (TelemetryOut) under Key.
/// Stale when the flow has not published it for StaleAfterMs (flow off or node not reached),
/// no data before the first value.
/// </summary>
[TelemetryValue("", TelemetryDataType.Number)]
public class FlowValueReader : TelemetryReaderBase
{
    private readonly FlowTelemetryStore _store;

    /// <summary>Key of the TelemetryOut node in the vehicle flow.</summary>
    public string Key { get; set; } = string.Empty;

    /// <summary>After this many ms without a new value from the flow the value counts as stale.</summary>
    public int StaleAfterMs { get; set; } = 2000;

    public FlowValueReader(ILogger<FlowValueReader> logger, FlowTelemetryStore store) : base(logger)
    {
        _store = store;
    }

    /// <summary>The sample for a stored value (or none) at the given age.</summary>
    public static TelemetrySample Sample((double Value, long AgeMs)? stored, int staleAfterMs)
    {
        if (stored is not { } v) return new TelemetrySample(string.Empty, TelemetrySampleState.NoData, 0);
        var text = double.IsFinite(v.Value) ? v.Value.ToString("0.######", CultureInfo.InvariantCulture) : "0";
        var age = (int)Math.Min(int.MaxValue, Math.Max(0, v.AgeMs));
        return new TelemetrySample(text, v.AgeMs > Math.Max(1, staleAfterMs) ? TelemetrySampleState.Stale : TelemetrySampleState.Valid, age);
    }

    public override Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey) =>
        Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(
            new Dictionary<string, TelemetrySample> { [channelKey] = Sample(_store.Get(Key.Trim()), StaleAfterMs) });

    public override Task<string> ReadTelemetry() => Task.FromResult(Sample(_store.Get(Key.Trim()), StaleAfterMs).Value);
}
