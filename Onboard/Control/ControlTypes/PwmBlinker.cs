using Microsoft.Extensions.Logging;
using System.Threading;
using System.Threading.Tasks;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("PwmBlinker")]
public class PwmBlinker : PwmLight
{
    public int BlinkCycleMs { get; set; } = 500; // Dauer eines Blinkzyklus in ms
    private CancellationTokenSource? _blinkCts;

    public PwmBlinker(ILogger<PwmBlinker> logger) : base(logger)
    {
    }

    public override void OnControlRecived(decimal newValue)
    {
        if (_pwmModule == null)
        {
            Logger.LogError("PWM module is not initialized. Cannot set LED brightness.");
            return;
        }
        _blinkCts?.Cancel();
        if (newValue > 0)
        {
            _blinkCts = new CancellationTokenSource();
            _ = BlinkAsync(_blinkCts.Token);
        }
        else
        {
            base.OnControlRecived(0);
        }
    }

    private async Task BlinkAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            base.OnControlRecived(1);
            await Task.Delay(BlinkCycleMs);
            base.OnControlRecived(0);
            await Task.Delay(BlinkCycleMs);
        }
    }

    public override void OnControlReleased()
    {
        _blinkCts?.Cancel();
        base.OnControlReleased();
    }
}
