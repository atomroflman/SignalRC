using System;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Telemetry
{
    public class ApplicationLifetimeReader : TelemetryReaderBase
    {
        private readonly DateTime _startTime;

        public ApplicationLifetimeReader(ILogger<ApplicationLifetimeReader> logger) : base(logger)
        {
            _startTime = DateTime.UtcNow;
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