using System;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware;

public class RaspberryPiPwmPin : IPwmModule
{
    private readonly ILogger<RaspberryPiPwmPin> _logger;
    private float _lastValue = 0;
    private bool _initialized = false;

    public Bash Bash { get; }
    public int PinNumber { get; }

    public RaspberryPiPwmPin(IServiceProvider serviceProvider, int pinNumber)
    {
        _logger = serviceProvider.GetRequiredService<ILogger<RaspberryPiPwmPin>>();
        Bash = serviceProvider.GetRequiredService<Bash>();
        PinNumber = pinNumber;
    }

    private async Task InitializePin(int pinNumber)
    {
        if (_initialized)
            return;
        _initialized = true;
        _logger.LogInformation($"Initializing PWM pin {pinNumber}");
        await Bash.ExecuteAsync($"gpio -g mode {pinNumber} pwm");
        await Bash.ExecuteAsync("gpio pwm-ms");
        await Bash.ExecuteAsync("gpio pwmc 192");
        await Bash.ExecuteAsync("gpio pwmr 2000");
        await SetPwmCyclePercentage(0f); // Set initial value to 0
    }

    public async Task SetPwmCyclePercentage(float value)
    {
        if (!_initialized)
            await InitializePin(PinNumber);
        value = Math.Clamp(value, 0f, 1f);
        _lastValue = value;
        int pwmValue = (int)Math.Round(value * 2000); // Scale to 0-2000 for 50Hz PWM
        await Bash.ExecuteAsync($"gpio -g pwm {PinNumber} {pwmValue}");
    }

    public Task<float> GetPwmValue() => Task.FromResult(_lastValue);

    public async Task SetServoPosition(float position)
    {
        if (!_initialized)
            await InitializePin(PinNumber);
        position = Math.Clamp(position, -1f, 1f);
        _lastValue = position;
        int pwmValue = (int)Math.Round(50 + position * (250 - 50));
        await Bash.ExecuteAsync($"gpio -g pwm {PinNumber} {pwmValue}");
    }

    public Task SetPulseWidthMilliseconds(float pulseWidthMs)
    {
        if (!_initialized)
            InitializePin(PinNumber).Wait();
        
        if (pulseWidthMs < 0 || pulseWidthMs > 20)
            throw new ArgumentOutOfRangeException(nameof(pulseWidthMs), "Pulse width must be between 0 and 20 milliseconds.");

        // Convert milliseconds to PWM value (2000 for 50Hz)
        int pwmValue = (int)Math.Round((pulseWidthMs / 20) * 2000);
        _lastValue = pwmValue / 2000f; // Update last value as percentage
        return Bash.ExecuteAsync($"gpio -g pwm {PinNumber} {pwmValue}");        
    }
}
