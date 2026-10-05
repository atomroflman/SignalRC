using Microsoft.Extensions.Logging;
using LteCar.Onboard.Hardware;

namespace LteCar.Onboard.Control.ControlTypes;

public abstract class ServoControlBase : ControlTypeBase
{
    IPwmModule _pinInstance = null!;

    public ILogger<ServoControlBase> Logger { get; }

    public ServoControlBase(ILogger<ServoControlBase> logger) : base()
    {
        Logger = logger;
    }

    public override void Initialize()
    {
        _pinInstance = PinManager.GetModule<IPwmModule>(Address ?? 0);
        Logger.LogDebug($"Init: {_pinInstance} Address: {Address}");
        base.Initialize();
    }

    public override void OnControlRecived(decimal newValue)
    {
        if (_pinInstance == null)
        {
            Logger.LogError("Pin instance is not initialized. Cannot set PWM value.");
            return;
        }
        Logger.LogDebug($"{this.GetType().Name} rec: {newValue}");
        _pinInstance.SetServoPosition((float)newValue);
    }

    protected override async Task RunTestInternalAsync()
    {
        const int DELAY = 1000;
        for (int i = 0; i < 5; i++)
        {
            OnControlRecived(-1);
            await Task.Delay(DELAY);
            OnControlRecived(1);
            await Task.Delay(DELAY);
        }
        OnControlReleased();
    }

    public override void OnControlReleased()
    {
        OnControlRecived(0);
    }
}