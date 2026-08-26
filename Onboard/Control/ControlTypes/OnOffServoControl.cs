using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("OnOffServo")]
public class OnOffServoControl : ServoControlBase
{
    public OnOffServoControl(ILogger<SteeringControl> logger) : base(logger)
    {
    }

    public override string ToString() => $"OnOffServo@{Address}";

    public override void OnControlRecived(decimal newValue)
    {
        // On/Off servo logic: 0 = off, 1 = on
        base.OnControlRecived(Math.Round(newValue));
    }
}