using SignalRC.Shared.Channels;
using System.Globalization;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// What a PWM output (channel pinManager + address) currently drives. The PCA9685 is read back
/// from its registers (Valid; Error after a chip reset); Pi hardware PWM reports the last write (Unchecked).
/// </summary>
[TelemetryValue("", TelemetryDataType.Number, "%", Decimals = 1)]
[TelemetryValue("", TelemetryDataType.Number, Decimals = 3, When = "report=DutyCycle")]
[TelemetryValue("", TelemetryDataType.Number, "ms", Decimals = 3, When = "report=PulseWidthMs")]
[TelemetryValue("", TelemetryDataType.Integer, "µs", Decimals = 0, When = "report=PulseWidthUs")]
[TelemetryValue("", TelemetryDataType.Integer, Decimals = 0, When = "report=Counts")]
public class PwmOutputReader : PinReaderBase<IPwmModule>
{
    /// <summary>Unit of the value: Percent (duty 0–100), DutyCycle (0–1), PulseWidthMs, PulseWidthUs or Counts.</summary>
    public PwmReport Report { get; set; } = PwmReport.Percent;

    public PwmOutputReader(ILogger<PwmOutputReader> logger, IModuleManagerFactory factory) : base(logger, factory)
    {
    }

    protected override async Task<TelemetrySample> ReadSampleAsync(IPwmModule module)
    {
        var r = await module.ReadOutputAsync();
        if (r.Fault != null)
        {
            Logger.LogWarning("{Module}: {Fault}", module, r.Fault);
            return new TelemetrySample(string.Empty, TelemetrySampleState.Error, 0);
        }
        var value = Report switch
        {
            PwmReport.DutyCycle => r.DutyCycle.ToString("0.####", CultureInfo.InvariantCulture),
            PwmReport.PulseWidthMs => r.PulseWidthMs.ToString("0.###", CultureInfo.InvariantCulture),
            PwmReport.PulseWidthUs => Math.Round(r.PulseWidthMs * 1000).ToString(CultureInfo.InvariantCulture),
            PwmReport.Counts => r.Counts.ToString(CultureInfo.InvariantCulture),
            _ => (r.DutyCycle * 100).ToString("0.#", CultureInfo.InvariantCulture),
        };
        return new TelemetrySample(value, r.Measured ? TelemetrySampleState.Valid : TelemetrySampleState.Unchecked, 0);
    }
}

public enum PwmReport { Percent, DutyCycle, PulseWidthMs, PulseWidthUs, Counts }
