using System.Diagnostics;
using System.Globalization;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Power supply of a Raspberry Pi: whether it is under-voltage (below about 4.63 V) or
/// throttled, now or at any time since boot. Reads <c>vcgencmd get_throttled</c>; without
/// it only the current under-voltage alarm of the rpi_volt hwmon sensor
/// (<c>in0_lcrit_alarm</c>) is available. Report picks the value:
/// <list type="bullet">
/// <item>Ok (default): 1 while the supply is fine (no under-voltage now), else 0.</item>
/// <item>UnderVoltage / UnderVoltageSinceBoot: 1/0.</item>
/// <item>Throttled / ThrottledSinceBoot: frequency capped, throttled or at the soft temperature limit, 1/0.</item>
/// <item>Raw: the get_throttled bits as hex, e.g. 0x50005.</item>
/// <item>CoreVolts: core voltage in V (vcgencmd measure_volts core) – that is the regulated
/// SoC voltage, not the 5 V input, which a Pi 3 cannot measure.</item>
/// </list>
/// </summary>
[TelemetryValue("", TelemetryDataType.Boolean)]
[TelemetryValue("", TelemetryDataType.String, When = "report=Raw")]
[TelemetryValue("", TelemetryDataType.Number, "V", Decimals = 3, When = "report=CoreVolts")]
public class PowerSupplyReader : TelemetryReaderBase
{
    private const string Vcgencmd = "/usr/bin/vcgencmd";
    private const string HwmonDirectory = "/sys/class/hwmon";

    public PowerSupplyReport Report { get; set; } = PowerSupplyReport.Ok;

    public PowerSupplyReader(ILogger<PowerSupplyReader> logger) : base(logger) { }

    // get_throttled bits (Raspberry Pi documentation, vcgencmd).
    public const uint UnderVoltageNow = 1u << 0;
    public const uint ThrottledNowMask = (1u << 1) | (1u << 2) | (1u << 3);
    public const uint UnderVoltageOccurred = 1u << 16;
    public const uint ThrottledOccurredMask = (1u << 17) | (1u << 18) | (1u << 19);

    /// <summary>The bits of "throttled=0x50005", null if the text has none.</summary>
    public static uint? ParseThrottled(string output)
    {
        var m = Regex.Match(output, @"throttled=0x([0-9a-fA-F]+)");
        return m.Success && uint.TryParse(m.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var v) ? v : null;
    }

    /// <summary>The reported value for the bits; CoreVolts is not derived from them (null).</summary>
    public static string? Evaluate(PowerSupplyReport report, uint bits) => report switch
    {
        PowerSupplyReport.Ok => (bits & UnderVoltageNow) == 0 ? "1" : "0",
        PowerSupplyReport.UnderVoltage => (bits & UnderVoltageNow) != 0 ? "1" : "0",
        PowerSupplyReport.UnderVoltageSinceBoot => (bits & (UnderVoltageNow | UnderVoltageOccurred)) != 0 ? "1" : "0",
        PowerSupplyReport.Throttled => (bits & ThrottledNowMask) != 0 ? "1" : "0",
        PowerSupplyReport.ThrottledSinceBoot => (bits & (ThrottledNowMask | ThrottledOccurredMask)) != 0 ? "1" : "0",
        PowerSupplyReport.Raw => "0x" + bits.ToString("x", CultureInfo.InvariantCulture),
        _ => null,
    };

    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var started = Stopwatch.GetTimestamp();
        var value = await ReadValueAsync();
        var ageMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
        var sample = value == null
            ? new TelemetrySample("error", TelemetrySampleState.Error, ageMs)
            : new TelemetrySample(value, TelemetrySampleState.Valid, ageMs);
        return new Dictionary<string, TelemetrySample> { [channelKey] = sample };
    }

    public override async Task<string> ReadTelemetry() => await ReadValueAsync() ?? "error";

    private async Task<string?> ReadValueAsync()
    {
        try
        {
            if (Report == PowerSupplyReport.CoreVolts)
            {
                var volts = await RunAsync("measure_volts core");
                var m = volts == null ? null : Regex.Match(volts, @"volt=([0-9.]+)V");
                return m is { Success: true } ? m.Groups[1].Value : null;
            }
            var output = await RunAsync("get_throttled");
            var bits = output == null ? null : ParseThrottled(output);
            if (bits != null) return Evaluate(Report, bits.Value);
            // Without vcgencmd: the current under-voltage alarm only.
            if (Report is PowerSupplyReport.Ok or PowerSupplyReport.UnderVoltage && ReadHwmonAlarm() is { } alarm)
                return Report == PowerSupplyReport.Ok ? (alarm ? "0" : "1") : (alarm ? "1" : "0");
            return null;
        }
        catch (Exception ex)
        {
            Logger.LogDebug(ex, "Reading the power supply state failed.");
            return null;
        }
    }

    private static bool? ReadHwmonAlarm()
    {
        if (!Directory.Exists(HwmonDirectory)) return null;
        foreach (var dir in Directory.GetDirectories(HwmonDirectory))
        {
            var name = Path.Combine(dir, "name");
            var alarm = Path.Combine(dir, "in0_lcrit_alarm");
            if (File.Exists(name) && File.ReadAllText(name).Trim() == "rpi_volt" && File.Exists(alarm))
                return File.ReadAllText(alarm).Trim() == "1";
        }
        return null;
    }

    private static async Task<string?> RunAsync(string arguments)
    {
        if (!File.Exists(Vcgencmd)) return null;
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = Vcgencmd,
            Arguments = arguments,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        });
        if (process == null) return null;
        var output = await process.StandardOutput.ReadToEndAsync();
        await process.WaitForExitAsync();
        return process.ExitCode == 0 ? output : null;
    }
}

public enum PowerSupplyReport
{
    Ok,
    UnderVoltage,
    UnderVoltageSinceBoot,
    Throttled,
    ThrottledSinceBoot,
    Raw,
    CoreVolts,
}
