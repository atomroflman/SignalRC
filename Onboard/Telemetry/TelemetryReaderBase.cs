using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Telemetry;

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

    public void Dispose()
    {
    }
}
