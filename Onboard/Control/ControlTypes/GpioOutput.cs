using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;

namespace SignalRC.Onboard.Control.ControlTypes;

/// <summary>
/// Switches a digital pin: on at or above the threshold, off below. activeLow and the start
/// level are set on the pin in the pin manager.
/// </summary>
[ControlType("GpioOutput")]
public class GpioOutput : ControlTypeBase
{
    private readonly ILogger<GpioOutput> _logger;
    private IGpioModule? _pin;
    private bool? _state;

    /// <summary>Values at or above this switch the pin on.</summary>
    public decimal Threshold { get; set; } = 0.5m;

    /// <summary>State when the driver releases the channel: Off, On or Keep.</summary>
    public GpioReleaseState ReleaseState { get; set; } = GpioReleaseState.Off;

    public GpioOutput(ILogger<GpioOutput> logger)
    {
        _logger = logger;
    }

    public override string ToString() => $"GpioOutput@{Address}";

    public override void Initialize()
    {
        _pin = PinManager.GetModule<IGpioModule>(Address ?? throw new InvalidOperationException("GpioOutput needs an address (pin)."));
        base.Initialize();
    }

    public override void OnControlRecived(decimal newValue) => Set(newValue >= Threshold);

    public override void OnControlReleased()
    {
        if (ReleaseState != GpioReleaseState.Keep)
            Set(ReleaseState == GpioReleaseState.On);
    }

    private void Set(bool on)
    {
        if (_pin == null || _state == on) return;
        _state = on;
        _logger.LogDebug("{Control} -> {State}", this, on);
        Observe(_pin.SetValue(on));
    }

    protected override async Task RunTestInternalAsync()
    {
        for (var i = 0; i < 3; i++)
        {
            Set(true);
            await Task.Delay(300);
            Set(false);
            await Task.Delay(300);
        }
        OnControlReleased();
    }
}

public enum GpioReleaseState { Off, On, Keep }
