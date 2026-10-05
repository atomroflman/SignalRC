using Microsoft.Extensions.Logging;
using LteCar.Onboard.Hardware;

namespace LteCar.Onboard.Control.ControlTypes
{
    [ControlType("RotaryLight")]
    public class RotaryLight : ControlTypeBase
    {
        const float LOW_PWM = 1.5f; // 1.5ms pulse width
        const float HIGH_PWM = 2.5f; // 2.5ms pulse width
    
        private IPwmModule? _pwm;
        private byte _currentMode = 0;
        private bool _isHigh = false;
        public int AvailableModes { get;set; } = 10; 

        public RotaryLight(ILogger<ServoControlBase> logger)
        {
            Logger = logger;
        }

        public ILogger<ServoControlBase> Logger { get; }

        public override void Initialize()
        {
            base.Initialize();
            _pwm = PinManager.GetModule<IPwmModule>(Address ?? 0);
            _pwm.SetPulseWidthMilliseconds(LOW_PWM);
        }

        public override void OnControlRecived(decimal newValue)
        {
            if (_pwm == null)
            {
                Logger.LogError("PWM-Modul nicht initialisiert.");
                return;
            }
            var res = (int)Math.Round(newValue, 0);
            var selectedMode = (byte)(res % AvailableModes);
            Task.Run(() => SetModeAsync(selectedMode));
        }

        async Task SetModeAsync(int selectedMode)
        {
            while (_currentMode != selectedMode)
            {
                await SetNextModeAsync();
                await Task.Delay(40);
            }
        }

        private Task SetNextModeAsync()
        {
            _currentMode = (byte)((_currentMode + 1) % AvailableModes);
            _isHigh = !_isHigh;
            var pulseWidth = _isHigh ? HIGH_PWM : LOW_PWM;
            _pwm?.SetPulseWidthMilliseconds(pulseWidth);
            Logger.LogDebug($"RotaryLight: Set mode {_currentMode} with pulse width {pulseWidth}ms");
            return Task.CompletedTask;
        }

        protected override async Task RunTestInternalAsync()
        {
            for (int i = 0; i < AvailableModes; i++)
            {
                OnControlRecived(i);
                await Task.Delay(3000);
            }
        }

        public override void OnControlReleased()
        {
            if (_pwm != null)
                _pwm.SetPwmCyclePercentage(0);
        }
    }
}
