using System;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Telemetry
{
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
            var uptimeString = $"{applicationUptime.Days}d {applicationUptime.Hours}h {applicationUptime.Minutes}m {applicationUptime.Seconds}s";
            Logger.LogDebug($"Application Uptime: {uptimeString}");
            return Task.FromResult(uptimeString);
        }
    }
}