namespace SignalRC.Onboard.Hardware;

/// <summary>
/// What is wired to a pin or PWM channel. Only documentation: the wiring diagram draws it,
/// the onboard does not change its behaviour. Auto lets the diagram guess from the channels.
/// </summary>
public enum ConnectedDevice { Auto, Led, Relay, Buzzer, Servo, Esc, Button, Sensor, Other }

/// <summary>Configuration of one PCA9685 output channel (documentation for the wiring diagram).</summary>
public class PcaChannelConfig
{
    /// <summary>Output channel 0–15.</summary>
    public int Channel { get; set; }
    /// <summary>What is plugged into the channel.</summary>
    public ConnectedDevice Device { get; set; } = ConnectedDevice.Auto;
    /// <summary>Free text, e.g. "Blinker links".</summary>
    public string? Label { get; set; }
}
