using Microsoft.Extensions.Logging;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

public abstract class TelemetryReaderBase : IDisposable
{
    protected readonly ILogger Logger;
    public int ReadIntervalTicks { get; set; } = 1;

    public TelemetryReaderBase(ILogger logger)
    {
        Logger = logger;
    }

    public abstract Task<string> ReadTelemetry();

    /// <summary>
    /// Reads all telemetry values this reader can provide in a single tick.
    /// Default implementation forwards to <see cref="ReadTelemetry"/> and wraps
    /// the result in a dictionary with a single entry keyed by the channel name
    /// passed in via <paramref name="channelKey"/>. Readers that expose multiple
    /// logical channels (e.g. JBD BMS) should override this and return all raw
    /// fields at once (without prefix). Returning <c>null</c> signals "no data".
    /// </summary>
    public virtual async Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var value = await ReadTelemetry();
        if (value == null)
        {
            return null;
        }
        return new Dictionary<string, string> { [channelKey] = value };
    }

    /// <summary>
    /// Like <see cref="ReadAllTelemetryAsync"/>, but each value carries its
    /// source quality and measurement age (telemetry/README.md §3, §4). The
    /// default knows nothing about quality and reports every value as
    /// <see cref="TelemetrySampleState.Unchecked"/> with age 0. Readers that
    /// know better override this; <see cref="ReadAllTelemetryAsync"/> stays the
    /// plain-string view used by the legacy path and the probe tool.
    /// </summary>
    public virtual async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var values = await ReadAllTelemetryAsync(channelKey);
        return values == null ? null : WrapAll(values, TelemetrySampleState.Unchecked, 0);
    }

    /// <summary>Gives every value the same state and age.</summary>
    protected static IReadOnlyDictionary<string, TelemetrySample> WrapAll(
        IReadOnlyDictionary<string, string> values, TelemetrySampleState state, int ageMs)
    {
        var samples = new Dictionary<string, TelemetrySample>(values.Count, StringComparer.Ordinal);
        foreach (var (key, value) in values)
        {
            samples[key] = new TelemetrySample(value, state, ageMs);
        }
        return samples;
    }

    /// <summary>Called when the reader is dropped, e.g. its channel was changed or deleted.</summary>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    protected virtual void Dispose(bool disposing)
    {
    }
}
