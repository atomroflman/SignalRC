using SignalRC.Shared.Channels;
using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

// Only the keys the code knows; the rest come from jbdtool and get no suggestion.
[TelemetryValue("voltage", TelemetryDataType.Number, "V", Decimals = 2)]
[TelemetryValue("current", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("soc", TelemetryDataType.Integer, "%", Decimals = 0)]
[TelemetryValue("remaining", TelemetryDataType.Number, "Ah", Decimals = 2)]
[TelemetryValue("capacity", TelemetryDataType.Number, "Ah", Decimals = 2)]
[TelemetryValue("cycles", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("temperature", TelemetryDataType.Number, "°C", Decimals = 1)]
[TelemetryValue("currentAvg", TelemetryDataType.Number, "A", Decimals = 2)]
[TelemetryValue("runtime", TelemetryDataType.Number, "h", Decimals = 2)]
public class JbdBmsTelemetryReader : TelemetryReaderBase
{
    private readonly Bash _bash;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(2);

    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new();

    // Per battery like the cache: channels of one battery can have their own reader instance.
    private static readonly ConcurrentDictionary<string, BatteryRuntimeEstimator> Estimators = new();

    private sealed record CacheEntry(DateTime FetchedAtUtc, IReadOnlyDictionary<string, string> Values);

    /// <summary>
    /// Transport target. Either a serial device path (e.g. /dev/ttyUSB0) or a
    /// Bluetooth MAC address (e.g. AA:BB:CC:DD:EE:FF).
    /// </summary>
    public string Channel { get; set; } = string.Empty;

    /// <summary>Path of the jbdtool CLI.</summary>
    public string JbdToolPath { get; set; } = "~/signalrc/bin/jbdtools";

    public JbdBmsTelemetryReader(ILogger<JbdBmsTelemetryReader> logger, ILogger<Bash> bashLogger, Bash bash)
        : base(logger)
    {
        _bash = bash;

        try
        {
            var whichResult = _bash.ExecuteAndRead("which jbdtool")?.Trim();
            if (string.IsNullOrEmpty(whichResult) || !File.Exists(whichResult))
            {
                Logger.LogWarning("jbdtool CLI was not found in PATH. Install via: sudo apt install python3-venv python3-pip && python3 -m venv ~/signalrc && source ~/signalrc/bin/activate && pip install jbdtools");
            }
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to probe for jbdtool in PATH.");
        }
    }

    public override Task<string> ReadTelemetry()
    {
        // Multi-channel readers expose values via ReadAllTelemetryAsync. The
        // legacy single-value contract still exists for compatibility.
        return Task.FromResult(string.Empty);
    }

    public override async Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        if (string.IsNullOrWhiteSpace(Channel))
        {
            Logger.LogWarning("JBD reader invoked without a configured Channel.");
            return null;
        }

        if (Cache.TryGetValue(Channel, out var cached) && DateTime.UtcNow - cached.FetchedAtUtc < CacheTtl)
        {
            return cached.Values;
        }

        string output;
        try
        {
            output = await Task.Run(() => _bash.ExecuteAndRead(BuildCommand(json: true))) ?? string.Empty;
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to execute jbdtool for channel {Channel}", Channel);
            return null;
        }

        var parsed = ParseJbdOutput(output);
        if (parsed == null || parsed.Count == 0)
        {
            return null;
        }

        var now = DateTime.UtcNow;
        var values = WithRuntime(parsed, Estimators.GetOrAdd(Channel, _ => new BatteryRuntimeEstimator()), now);
        Cache[Channel] = new CacheEntry(now, values);
        return values;
    }

    /// <summary>
    /// Values with quality. The jbdtool output is cached for <see cref="CacheTtl"/>,
    /// so a value is as old as its cache entry (same device, so the wall clock
    /// difference is fine). If the current read failed but an older result is
    /// still cached, that result goes out as Error with its real age; without
    /// any result there is nothing to send (the channels stay "waiting").
    /// </summary>
    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var values = await ReadAllTelemetryAsync(channelKey);
        Cache.TryGetValue(Channel, out var entry);
        return BuildSamples(values, entry?.Values, entry?.FetchedAtUtc, DateTime.UtcNow);
    }

    /// <summary>
    /// <paramref name="values"/>: this read's result (null = failed);
    /// <paramref name="cached"/>/<paramref name="fetchedAtUtc"/>: the cache
    /// entry after the read, if any.
    /// </summary>
    public static IReadOnlyDictionary<string, TelemetrySample>? BuildSamples(
        IReadOnlyDictionary<string, string>? values,
        IReadOnlyDictionary<string, string>? cached,
        DateTime? fetchedAtUtc,
        DateTime nowUtc)
    {
        if (values != null)
        {
            // A fresh or cached result: valid, as old as its fetch. Values
            // without a cache entry cannot occur today; treat them as fresh.
            var age = fetchedAtUtc.HasValue ? TelemetrySample.AgeFromUtc(fetchedAtUtc.Value, nowUtc) : 0;
            return WrapAll(values, TelemetrySampleState.Valid, age);
        }
        if (cached != null && fetchedAtUtc.HasValue)
        {
            return WrapAll(cached, TelemetrySampleState.Error, TelemetrySample.AgeFromUtc(fetchedAtUtc.Value, nowUtc));
        }
        return null;
    }

    /// <summary>
    /// Adds <c>currentAvg</c> (A, one hour average) and <c>runtime</c> (hours) to a fresh read. Without
    /// an estimate the keys are missing, so these channels get no new value while charging or idle.
    /// </summary>
    public static IReadOnlyDictionary<string, string> WithRuntime(
        IReadOnlyDictionary<string, string> values, BatteryRuntimeEstimator estimator, DateTime nowUtc)
    {
        if (!TryGetNumber(values, "current", out var current))
            return values;
        estimator.Add(nowUtc, current);
        var average = estimator.AverageAmps();
        if (average == null)
            return values;

        var result = new Dictionary<string, string>(values, StringComparer.Ordinal)
        {
            ["currentAvg"] = average.Value.ToString("0.###", CultureInfo.InvariantCulture),
        };
        if (TryGetNumber(values, "remaining", out var remaining)
            && BatteryRuntimeEstimator.RuntimeHours(remaining, average) is { } hours)
        {
            result["runtime"] = hours.ToString("0.##", CultureInfo.InvariantCulture);
        }
        return result;
    }

    private static bool TryGetNumber(IReadOnlyDictionary<string, string> values, string key, out double number)
    {
        number = 0;
        return values.TryGetValue(key, out var text)
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out number);
    }

    private string BuildCommand(bool json)
    {
        var target = Channel.StartsWith("/dev/", StringComparison.Ordinal)
            ? $"serial:{Channel},9600"
            : $"bt:{Channel}";

        // No -r -a: that reads the configuration from the EEPROM (about a minute, no live values).
        var args = new List<string> { "-t", target };
        if (json)
        {
            args.Add("-j");
        }
        return $"{JbdToolPath} {string.Join(' ', args)}";
    }

    private static IReadOnlyDictionary<string, string>? ParseJbdOutput(string output)
    {
        if (string.IsNullOrWhiteSpace(output))
        {
            return null;
        }

        var trimmed = output.TrimStart();

        if (trimmed.StartsWith("{", StringComparison.Ordinal))
        {
            try
            {
                using var doc = JsonDocument.Parse(trimmed);
                if (doc.RootElement.ValueKind == JsonValueKind.Object)
                {
                    var dict = FlattenJson(doc.RootElement, prefix: null);
                    if (dict.Count == 0)
                    {
                        return null;
                    }
                    NormalizeKeys(dict);
                    return dict;
                }
            }
            catch (JsonException ex)
            {
                // Fall through to text parser.
                _ = ex;
            }
        }

        var textDict = ParseTextOutput(output);
        if (textDict.Count == 0)
        {
            return null;
        }
        NormalizeKeys(textDict);
        return textDict;
    }

    private static Dictionary<string, string> FlattenJson(JsonElement element, string? prefix)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    var key = prefix is null ? property.Name : $"{prefix}.{property.Name}";
                    foreach (var inner in FlattenJson(property.Value, key))
                    {
                        result[inner.Key] = inner.Value;
                    }
                }
                break;
            case JsonValueKind.Array:
                var index = 0;
                foreach (var item in element.EnumerateArray())
                {
                    var key = prefix is null ? index.ToString() : $"{prefix}{index}";
                    foreach (var inner in FlattenJson(item, key))
                    {
                        result[inner.Key] = inner.Value;
                    }
                    index++;
                }
                break;
            default:
                if (prefix != null)
                {
                    result[prefix] = element.ToString();
                }
                break;
        }
        return result;
    }

    private static readonly Regex TextLineRegex = new(@"^\s*([A-Za-z_][\w]*)\s*[:=]\s*(.+?)\s*$", RegexOptions.Compiled);

    private static Dictionary<string, string> ParseTextOutput(string output)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var rawLine in output.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0)
            {
                continue;
            }
            var match = TextLineRegex.Match(line);
            if (!match.Success)
            {
                continue;
            }
            result[match.Groups[1].Value] = match.Groups[2].Value.Trim();
        }
        return result;
    }

    private static readonly Dictionary<string, string> KeyAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["designCapacity"] = "capacity",
        ["percentCapacity"] = "soc",
        ["remainingCapacity"] = "remaining",
        ["cycleCount"] = "cycles",
        ["cellTotal"] = "cellsTotal",
        ["cellMin"] = "cellsMin",
        ["cellMax"] = "cellsMax",
        ["cellDiff"] = "cellsDiff",
        ["cellAvg"] = "cellsAvg",
        ["protectbits"] = "protectionFlags",
        ["fetstate"] = "fet",
    };

    private static void NormalizeKeys(Dictionary<string, string> dict)
    {
        var rewritten = new Dictionary<string, string>(dict.Count, StringComparer.Ordinal);
        foreach (var kv in dict)
        {
            var key = char.ToLowerInvariant(kv.Key[0]) + kv.Key[1..];
            if (KeyAliases.TryGetValue(key, out var alias))
            {
                key = alias;
            }
            rewritten[key] = kv.Value;
        }
        // Convenience alias: expose the first temperature probe as `temperature`
        // so channelMap entries like `battery.temperature` resolve without
        // needing to know the exact probe index.
        if (rewritten.TryGetValue("temps0", out var firstTemp) && !rewritten.ContainsKey("temperature"))
        {
            rewritten["temperature"] = firstTemp;
        }
        dict.Clear();
        foreach (var kv in rewritten)
        {
            dict[kv.Key] = kv.Value;
        }
    }
}
