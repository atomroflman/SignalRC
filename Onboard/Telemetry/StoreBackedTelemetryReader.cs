using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Telemetry;

// ponytail: emits whatever TelemetryStore holds for this channel on each tick.
// No default value — readers see null (which TelemetryService skips) until a
// value arrives via ITelemetryClient.UpdateTelemetry. Used to validate the
// end-to-end pipeline (browser -> server -> onboard -> store -> back) without
// needing real sensor hardware.
public class StoreBackedTelemetryReader : TelemetryReaderBase
{
    private readonly TelemetryStore _store;

    public StoreBackedTelemetryReader(ILogger<StoreBackedTelemetryReader> logger, TelemetryStore store)
        : base(logger)
    {
        _store = store;
    }

    public override async Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var v = _store.Get(channelKey);
        return v == null ? null : new Dictionary<string, string> { [channelKey] = v };
    }

    public override Task<string> ReadTelemetry() =>
        throw new NotSupportedException("StoreBackedTelemetryReader uses ReadAllTelemetryAsync(channelKey).");
}
