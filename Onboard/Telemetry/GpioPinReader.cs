using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// State of a digital pin (channel pinManager + address = physical header pin): "1"/"0",
/// for HUD and flows. Inputs keep a pulse shorter than the read interval visible for one read.
/// Pull resistor, activeLow and debounce are set on the pin in the pin manager.
/// </summary>
public class GpioPinReader : PinReaderBase<IGpioModule>
{
    /// <summary>What to report: State (1/0) or Edges (debounced changes counted since start).</summary>
    public GpioReport Report { get; set; } = GpioReport.State;

    /// <summary>Report 1 for one read when the input was active in between, even if it is 0 again.</summary>
    public bool Latch { get; set; } = true;

    public GpioPinReader(ILogger<GpioPinReader> logger, IModuleManagerFactory factory) : base(logger, factory)
    {
    }

    protected override async Task<TelemetrySample> ReadSampleAsync(IGpioModule module)
    {
        var reading = await module.ReadAsync();
        var value = Report == GpioReport.Edges
            ? reading.Edges.ToString(System.Globalization.CultureInfo.InvariantCulture)
            : (Latch ? reading.Latched : reading.Value) ? "1" : "0";
        return new TelemetrySample(value, reading.Measured ? TelemetrySampleState.Valid : TelemetrySampleState.Unchecked, 0);
    }
}

public enum GpioReport { State, Edges }
