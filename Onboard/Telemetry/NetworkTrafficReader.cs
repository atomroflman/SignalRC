using System.Diagnostics;
using System.Globalization;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Network traffic of the vehicle in kbit/s from the byte counters in <c>/proc/net/dev</c>:
/// everything the vehicle sends or receives on the interface (video, audio, telemetry,
/// control and anything else), averaged over the time since the previous read. The first
/// read after start only takes the counters and has no value yet.
/// </summary>
[TelemetryValue("", TelemetryDataType.Number, "kbit/s", Decimals = 0)]
public class NetworkTrafficReader : TelemetryReaderBase
{
    private const string NetDevPath = "/proc/net/dev";

    /// <summary>
    /// Interface to measure, e.g. "wlan0" or "wwan0". Empty (default): all interfaces
    /// except loopback, summed.
    /// </summary>
    public string Interface { get; set; } = "";

    /// <summary>Direction: Tx (default) = sent by the vehicle (upload), Rx = received, Total = both.</summary>
    public NetworkTrafficReport Report { get; set; } = NetworkTrafficReport.Tx;

    private (long Rx, long Tx, long Timestamp)? _previous;

    public NetworkTrafficReader(ILogger<NetworkTrafficReader> logger) : base(logger) { }

    /// <summary>Byte counters per interface from the text of /proc/net/dev.</summary>
    public static Dictionary<string, (long Rx, long Tx)> ParseNetDev(string text)
    {
        var result = new Dictionary<string, (long Rx, long Tx)>(StringComparer.Ordinal);
        foreach (var line in text.Split('\n'))
        {
            // "  wlan0: 123 4 0 0 0 0 0 0 456 7 0 0 0 0 0 0" – the two header lines have no colon
            // before the numbers; rx bytes is field 0, tx bytes field 8.
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var name = line[..colon].Trim();
            var fields = line[(colon + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (name.Length == 0 || fields.Length < 9) continue;
            if (long.TryParse(fields[0], NumberStyles.None, CultureInfo.InvariantCulture, out var rx)
                && long.TryParse(fields[8], NumberStyles.None, CultureInfo.InvariantCulture, out var tx))
                result[name] = (rx, tx);
        }
        return result;
    }

    /// <summary>
    /// Rx/Tx bytes of the chosen interface, or all but loopback summed for an empty name;
    /// null when the interface does not exist.
    /// </summary>
    public static (long Rx, long Tx)? Select(Dictionary<string, (long Rx, long Tx)> counters, string interfaceName)
    {
        if (!string.IsNullOrWhiteSpace(interfaceName))
            return counters.TryGetValue(interfaceName.Trim(), out var one) ? one : null;
        long rx = 0, tx = 0;
        foreach (var (name, c) in counters)
        {
            if (name == "lo") continue;
            rx += c.Rx;
            tx += c.Tx;
        }
        return (rx, tx);
    }

    /// <summary>
    /// kbit/s between two counter readings; null when no time passed or a counter went
    /// backwards (interface restarted, counters reset).
    /// </summary>
    public static double? Rate(NetworkTrafficReport report, (long Rx, long Tx) before, (long Rx, long Tx) after, double seconds)
    {
        if (seconds <= 0) return null;
        var rx = after.Rx - before.Rx;
        var tx = after.Tx - before.Tx;
        if (rx < 0 || tx < 0) return null;
        var bytes = report switch
        {
            NetworkTrafficReport.Rx => rx,
            NetworkTrafficReport.Total => rx + tx,
            _ => tx,
        };
        return bytes * 8 / 1000.0 / seconds;
    }

    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var value = await ReadValueAsync();
        return value is { } sample ? new Dictionary<string, TelemetrySample> { [channelKey] = sample } : null;
    }

    public override async Task<string> ReadTelemetry() => (await ReadValueAsync())?.Value ?? "";

    private async Task<TelemetrySample?> ReadValueAsync()
    {
        string text;
        try
        {
            text = await File.ReadAllTextAsync(NetDevPath);
        }
        catch (Exception ex)
        {
            Logger.LogDebug(ex, "Reading {Path} failed", NetDevPath);
            return new TelemetrySample("error", TelemetrySampleState.Error, 0);
        }
        var now = Stopwatch.GetTimestamp();
        var counters = Select(ParseNetDev(text), Interface);
        if (counters == null)
        {
            _previous = null;
            return new TelemetrySample($"no interface {Interface}", TelemetrySampleState.Error, 0);
        }
        var previous = _previous;
        _previous = (counters.Value.Rx, counters.Value.Tx, now);
        if (previous == null) return null;
        var seconds = Stopwatch.GetElapsedTime(previous.Value.Timestamp, now).TotalSeconds;
        var rate = Rate(Report, (previous.Value.Rx, previous.Value.Tx), counters.Value, seconds);
        return rate == null ? null : new TelemetrySample(rate.Value.ToString("F1", CultureInfo.InvariantCulture), TelemetrySampleState.Valid, 0);
    }
}

public enum NetworkTrafficReport
{
    Tx,
    Rx,
    Total,
}
