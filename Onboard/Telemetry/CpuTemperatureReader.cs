using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Telemetry
{
    /// <summary>CPU temperature in °C as a plain number; the unit belongs to the channel.</summary>
    [TelemetryValue("", Shared.Channels.TelemetryDataType.Number, "°C", Decimals = 1)]
    public class CpuTemperatureReader : TelemetryReaderBase
    {
        private readonly string? _vcgencmdPath;

        public CpuTemperatureReader(ILogger<CpuTemperatureReader> logger) : base(logger)
        {
            _vcgencmdPath = FindVcgencmd();

            var hasSysfsTemp = GetTemperatureFiles().Any();
            if (!hasSysfsTemp && string.IsNullOrWhiteSpace(_vcgencmdPath))
            {
                Logger.LogWarning("No CPU temperature source found. Install `vcgencmd` on Raspberry Pi or ensure `/sys/class/thermal/thermal_zone*/temp` exists.");
            }
            else if (!hasSysfsTemp)
            {
                Logger.LogWarning("CPU temperature sysfs path not found. Falling back to `vcgencmd` at {Path}.", _vcgencmdPath);
            }
        }

        /// <summary>
        /// Reads the sensor directly, so the value is as old as the read:
        /// <c>Valid</c> with the read duration as age. The two failure strings
        /// <see cref="ReadTelemetry"/> returns are source errors.
        /// </summary>
        public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
        {
            var started = Stopwatch.GetTimestamp();
            var value = await ReadTelemetry();
            var ageMs = (int)Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            var state = value is "error" or "parse error"
                ? SignalRC.Shared.Telemetry.TelemetrySampleState.Error
                : SignalRC.Shared.Telemetry.TelemetrySampleState.Valid;
            return new Dictionary<string, TelemetrySample> { [channelKey] = new(value, state, ageMs) };
        }

        public override async Task<string> ReadTelemetry()
        {
            try
            {
                var sysfsTemp = await ReadSysfsTemperatureAsync();
                if (!string.IsNullOrWhiteSpace(sysfsTemp))
                {
                    return sysfsTemp;
                }

                if (!string.IsNullOrWhiteSpace(_vcgencmdPath))
                {
                    var vcgencmd = await ReadVcgencmdTemperatureAsync(_vcgencmdPath);
                    if (!string.IsNullOrWhiteSpace(vcgencmd))
                    {
                        return vcgencmd;
                    }
                }

                return "parse error";
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Failed to read CPU temperature");
                return "error";
            }
        }

        private static IEnumerable<string> GetTemperatureFiles()
        {
            var thermalDir = "/sys/class/thermal";
            if (!Directory.Exists(thermalDir))
            {
                return Enumerable.Empty<string>();
            }

            return Directory.GetDirectories(thermalDir, "thermal_zone*")
                .Select(dir => Path.Combine(dir, "temp"))
                .Where(File.Exists);
        }

        private async Task<string?> ReadSysfsTemperatureAsync()
        {
            foreach (var path in GetTemperatureFiles())
            {
                var content = await File.ReadAllTextAsync(path);
                if (int.TryParse(content.Trim(), out var tempMilliC))
                {
                    var tempC = tempMilliC / 1000.0;
                    Logger.LogTrace("CPU Temperature from sysfs: {Temp}°C", tempC);
                    return tempC.ToString("F2", CultureInfo.InvariantCulture);
                }
            }

            return null;
        }

        private static string? FindVcgencmd()
        {
            var candidates = new[] { "/usr/bin/vcgencmd", "/usr/local/bin/vcgencmd" };
            var existing = candidates.FirstOrDefault(File.Exists);
            if (!string.IsNullOrWhiteSpace(existing))
            {
                return existing;
            }

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "which",
                    Arguments = "vcgencmd",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using var process = Process.Start(psi);
                if (process == null)
                {
                    return null;
                }

                var output = process.StandardOutput.ReadToEnd().Trim();
                process.WaitForExit(2000);
                return string.IsNullOrWhiteSpace(output) ? null : output;
            }
            catch
            {
                return null;
            }
        }

        private async Task<string?> ReadVcgencmdTemperatureAsync(string vcgencmdPath)
        {
            var psi = new ProcessStartInfo
            {
                FileName = vcgencmdPath,
                Arguments = "measure_temp",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var process = Process.Start(psi);
            if (process == null)
            {
                return null;
            }

            var output = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();

            var match = Regex.Match(output, @"temp=([0-9]+(?:\.[0-9]+)?)'C");
            if (!match.Success)
            {
                return null;
            }

            if (!double.TryParse(match.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var tempC))
            {
                return null;
            }

            Logger.LogTrace("CPU Temperature from vcgencmd: {Temp}°C", tempC);
            return tempC.ToString("F2", CultureInfo.InvariantCulture);
        }
    }
}
