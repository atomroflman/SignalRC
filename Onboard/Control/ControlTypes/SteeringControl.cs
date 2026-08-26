using SignalRC.Onboard.Hardware;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("Steering")]
public class SteeringControl : ServoControlBase 
{ 
    public SteeringControl(ILogger<SteeringControl> logger) : base(logger)
    {        
    }

    public override string ToString() => $"Steering@{Address}";
}

[ControlType("ServoOnOff")]
public class ServoOnOffControl : ServoControlBase 
{ 
    public ServoOnOffControl(ILogger<ServoOnOffControl> logger) : base(logger)
    {        
    }

    public override string ToString() => $"ServoOnOff@{Address}";

    public override void OnControlRecived(decimal newValue) {
        if (newValue >= 0.5m)
            base.OnControlRecived(1);
        else
            base.OnControlRecived(-1);
    }
}
