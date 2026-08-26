using SignalRC.Onboard.Hardware;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("Throttle")]
public class ThrottleControl : ServoControlBase 
{
    public ThrottleControl(ILogger<ThrottleControl> logger) : base(logger)
    {
    }

    public override string ToString() => $"Throttle@{Address}";
 }