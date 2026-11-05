using System;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Telemetry
{
    /// <summary>Onboard uptime in whole seconds.</summary>
    [TelemetryValue("", Shared.Channels.TelemetryDataType.Integer, "s", Decimals = 0)]
    public class ApplicationLifetimeReader : TelemetryReaderBase
    {
        private readonly DateTime _startTime;

        public ApplicationLifetimeReader(ILogger<ApplicationLifetimeReader> logger) : base(logger)
        {
            _startTime = DateTime.UtcNow;
        }

        // Computed on the spot: always current.
        public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
        {
            var value = await ReadTelemetry();
            return new Dictionary<string, TelemetrySample> { [channelKey] = TelemetrySample.Valid(value) };
        }

        public override Task<string> ReadTelemetry()
        {
            var applicationUptime = DateTime.UtcNow - _startTime;
            // Whole seconds as a number, so it can be charted and formatted in the HUD.
            var uptimeString = ((long)applicationUptime.TotalSeconds).ToString(System.Globalization.CultureInfo.InvariantCulture);
            Logger.LogDebug($"Application Uptime: {uptimeString}");
            return Task.FromResult(uptimeString);
        }
    }
}