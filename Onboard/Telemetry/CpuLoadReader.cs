using System.Globalization;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// CPU load from <c>/proc/stat</c> in percent, averaged over the time since the previous
/// read (the first read after start has no value yet), or the load average from
/// <c>/proc/loadavg</c>.
/// </summary>
[TelemetryValue("", TelemetryDataType.Number, "%", Decimals = 0)]
[TelemetryValue("", TelemetryDataType.Number, Decimals = 2, When = "report=LoadAverage")]
public class CpuLoadReader : TelemetryReaderBase
{
    private const string StatPath = "/proc/stat";
    private const string LoadAvgPath = "/proc/loadavg";

    /// <summary>
    /// Average (default): all cores together in %. BusiestCore: the busiest single core in %;
    /// shows a single-threaded bottleneck (e.g. a software video encoder) that the average
    /// hides. LoadAverage: 1-minute load average, runnable processes (more than the core
    /// count = overloaded).
    /// </summary>
    public CpuLoadReport Report { get; set; } = CpuLoadReport.Average;

    private CpuTimes[]? _previous;

    public CpuLoadReader(ILogger<CpuLoadReader> logger) : base(logger) { }

    /// <summary>Busy and total jiffies of one "cpu" line.</summary>
    public readonly record struct CpuTimes(long Busy, long Total);

    /// <summary>
    /// The "cpu" lines of /proc/stat: index 0 is the sum of all cores, then cpu0, cpu1, ….
    /// Idle time is idle + iowait; steal and guest are left out of the total like top does.
    /// </summary>
    public static CpuTimes[] ParseStat(string text)
    {
        var result = new List<CpuTimes>();
        foreach (var line in text.Split('\n'))
        {
            if (!line.StartsWith("cpu", StringComparison.Ordinal)) continue;
            var fields = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            // cpu user nice system idle iowait irq softirq [steal guest guest_nice]
            if (fields.Length < 8) continue;
            var v = new long[7];
            var ok = true;
            for (var i = 0; i < 7; i++)
                ok &= long.TryParse(fields[i + 1], NumberStyles.None, CultureInfo.InvariantCulture, out v[i]);
            if (!ok) continue;
            var idle = v[3] + v[4];
            var total = v.Sum();
            result.Add(new CpuTimes(total - idle, total));
        }
        return result.ToArray();
    }

    /// <summary>Load in % between two readings; null when the core count changed or no time passed.</summary>
    public static double? Load(CpuLoadReport report, CpuTimes[] before, CpuTimes[] after)
    {
        if (before.Length == 0 || before.Length != after.Length) return null;
        static double? Percent(CpuTimes a, CpuTimes b)
        {
            var total = b.Total - a.Total;
            var busy = b.Busy - a.Busy;
            return total > 0 && busy >= 0 ? Math.Clamp(100.0 * busy / total, 0, 100) : null;
        }
        if (report != CpuLoadReport.BusiestCore || after.Length == 1) return Percent(before[0], after[0]);
        double? max = null;
        for (var i = 1; i < after.Length; i++)
        {
            if (Percent(before[i], after[i]) is { } p && (max == null || p > max)) max = p;
        }
        return max;
    }

    /// <summary>The 1-minute value of /proc/loadavg ("0.52 0.58 0.59 1/123 4567").</summary>
    public static double? ParseLoadAverage(string text)
    {
        var first = text.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        return double.TryParse(first, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var value = await ReadValueAsync();
        return value is { } sample ? new Dictionary<string, TelemetrySample> { [channelKey] = sample } : null;
    }

    public override async Task<string> ReadTelemetry() => (await ReadValueAsync())?.Value ?? "";

    private async Task<TelemetrySample?> ReadValueAsync()
    {
        try
        {
            if (Report == CpuLoadReport.LoadAverage)
            {
                var avg = ParseLoadAverage(await File.ReadAllTextAsync(LoadAvgPath));
                return avg == null
                    ? new TelemetrySample("parse error", TelemetrySampleState.Error, 0)
                    : new TelemetrySample(avg.Value.ToString("F2", CultureInfo.InvariantCulture), TelemetrySampleState.Valid, 0);
            }
            var current = ParseStat(await File.ReadAllTextAsync(StatPath));
            if (current.Length == 0) return new TelemetrySample("parse error", TelemetrySampleState.Error, 0);
            var previous = _previous;
            _previous = current;
            if (previous == null) return null;
            var load = Load(Report, previous, current);
            return load == null ? null : new TelemetrySample(load.Value.ToString("F1", CultureInfo.InvariantCulture), TelemetrySampleState.Valid, 0);
        }
        catch (Exception ex)
        {
            Logger.LogDebug(ex, "Reading CPU load failed");
            return new TelemetrySample("error", TelemetrySampleState.Error, 0);
        }
    }
}

public enum CpuLoadReport
{
    Average,
    BusiestCore,
    LoadAverage,
}
