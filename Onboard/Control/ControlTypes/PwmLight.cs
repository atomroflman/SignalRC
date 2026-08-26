// filepath: /home/greg-e/SignalRC/Onboard/Control/ControlTypes/PwmLight.cs
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("PwmLight")]
public class PwmLight : ControlTypeBase
{
    protected IPwmModule? _pwmModule;
    public ILogger<PwmLight> Logger { get; }

    private float _currentBrightness = 0f;
    private CancellationTokenSource? _fadeCts;

    public float InertiaStep { get; set; } = 0.2f;
    public int InertiaDelayMs { get; set; } = 10;

    public PwmLight(ILogger<PwmLight> logger) : base()
    {
        Logger = logger;
    }

    public override void Initialize()
    {
        _pwmModule = PinManager.GetModule<IPwmModule>(Address ?? 0);
        Logger.LogDebug($"PwmLight Init: {_pwmModule} Address: {Address}");
        base.Initialize();
    }

    public override void OnControlRecived(decimal newValue)
    {
        if (_pwmModule == null)
        {
            Logger.LogError("PWM module is not initialized. Cannot set LED brightness.");
            return;
        }
        float target = Math.Clamp((float)newValue, 0f, 1f);
        Logger.LogDebug($"PwmLight rec: {target}");
        _fadeCts?.Cancel();
        _fadeCts = new CancellationTokenSource();
        _ = FadeToAsync(target, _fadeCts.Token);
    }

    private async Task FadeToAsync(float target, CancellationToken token)
    {
        while (Math.Abs(_currentBrightness - target) > 0.01f)
        {
            if (token.IsCancellationRequested) return;
            if (_currentBrightness < target)
                _currentBrightness = Math.Min(_currentBrightness + InertiaStep, target);
            else
                _currentBrightness = Math.Max(_currentBrightness - InertiaStep, target);
            if (_pwmModule is not null)
                await _pwmModule.SetPwmCyclePercentage(_currentBrightness);
            await Task.Delay(InertiaDelayMs, token);
        }
        _currentBrightness = target;
        if (_pwmModule is not null)
            await _pwmModule.SetPwmCyclePercentage(_currentBrightness);
    }

    protected override async Task RunTestInternalAsync()
    {
        const int DELAY = 500;
        for (int i = 0; i < 3; i++)
        {
            OnControlRecived(1);
            await Task.Delay(DELAY);
            OnControlRecived(0);
            await Task.Delay(DELAY);
        }
        OnControlReleased();
    }

    public override void OnControlReleased()
    {
        OnControlRecived(0);
    }
}