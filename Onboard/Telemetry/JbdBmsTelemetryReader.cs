using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Telemetry;

public class JbdBmsTelemetryReader : TelemetryReaderBase
{
    private readonly Bash _bash;

    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(2);

    private static readonly ConcurrentDictionary<string, CacheEntry> Cache = new();

    private sealed record CacheEntry(DateTime FetchedAtUtc, IReadOnlyDictionary<string, string> Values);

    /// <summary>
    /// Transport target. Either a serial device path (e.g. /dev/ttyUSB0) or a
    /// Bluetooth MAC address (e.g. AA:BB:CC:DD:EE:FF).
    /// </summary>
    public string Channel { get; set; } = string.Empty;

    public string JbdToolPath { get; set; } = "~/ltecar/bin/jbdtools";

    public JbdBmsTelemetryReader(ILogger<JbdBmsTelemetryReader> logger, ILogger<Bash> bashLogger, Bash bash)
        : base(logger)
    {
        _bash = bash;

        try
        {
            var whichResult = _bash.ExecuteAndRead("which jbdtool")?.Trim();
            if (string.IsNullOrEmpty(whichResult) || !File.Exists(whichResult))
            {
                Logger.LogWarning("jbdtool CLI was not found in PATH. Install via: sudo apt install python3-venv python3-pip && python3 -m venv ~/ltecar && source ~/ltecar/bin/activate && pip install jbdtools");
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

        Cache[Channel] = new CacheEntry(DateTime.UtcNow, parsed);
        return parsed;
    }

    private string BuildCommand(bool json)
    {
        var target = Channel.StartsWith("/dev/", StringComparison.Ordinal)
            ? $"serial:{Channel},9600"
            : $"bt:{Channel}";

        var args = new List<string> { "-t", target, "-r", "-a" };
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
