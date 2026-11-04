using System;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware;

/// <summary>
/// Hardware PWM of a header pin via the wiringPi <c>gpio</c> tool (50 Hz: 19.2 MHz / 192 / 2000).
/// Created by <see cref="RaspberryPiGpioManager"/> with the BCM number of the pin.
/// </summary>
public class RaspberryPiPwmPin : IPwmModule
{
    private const int Range = 2000;
    private const float Frequency = 50f;

    private readonly ILogger<RaspberryPiPwmPin> _logger;
    private int _counts;
    private bool _initialized = false;

    public Bash Bash { get; }
    /// <summary>BCM number.</summary>
    public int PinNumber { get; }

    public RaspberryPiPwmPin(IServiceProvider serviceProvider, int pinNumber)
    {
        _logger = serviceProvider.GetRequiredService<ILogger<RaspberryPiPwmPin>>();
        Bash = serviceProvider.GetRequiredService<Bash>();
        PinNumber = pinNumber;
    }

    public override string ToString() => $"PWM BCM {PinNumber}";

    private async Task InitializePin(int pinNumber)
    {
        if (_initialized)
            return;
        _initialized = true;
        _logger.LogInformation($"Initializing PWM pin BCM {pinNumber}");
        await Bash.ExecuteAsync($"gpio -g mode {pinNumber} pwm");
        await Bash.ExecuteAsync("gpio pwm-ms");
        await Bash.ExecuteAsync("gpio pwmc 192");
        await Bash.ExecuteAsync($"gpio pwmr {Range}");
        await SetPwmCyclePercentage(0f); // Set initial value to 0
    }

    private async Task Write(int counts)
    {
        _counts = Math.Clamp(counts, 0, Range);
        await Bash.ExecuteAsync($"gpio -g pwm {PinNumber} {_counts}");
    }

    public async Task SetPwmCyclePercentage(float value)
    {
        if (!_initialized)
            await InitializePin(PinNumber);
        value = Math.Clamp(value, 0f, 1f);
        await Write((int)Math.Round(value * Range));
    }

    /// <summary>Duty cycle 0–1 of the last write.</summary>
    public Task<float> GetPwmValue() => Task.FromResult(_counts / (float)Range);

    /// <summary>The tool cannot read the PWM registers back: the last write, not measured.</summary>
    public Task<PwmReadback> ReadOutputAsync() => Task.FromResult(new PwmReadback(_counts, Range, Frequency, false, null));

    public async Task SetServoPosition(float position)
    {
        if (!_initialized)
            await InitializePin(PinNumber);
        position = Math.Clamp(position, -1f, 1f);
        // Same pulse range as the PCA9685 (105…550 of 4096): 0.51…2.69 ms of 20 ms.
        await Write((int)Math.Round(51 + (position + 1f) / 2f * (269 - 51)));
    }

    public async Task SetPulseWidthMilliseconds(float pulseWidthMs)
    {
        if (!_initialized)
            await InitializePin(PinNumber);

        if (pulseWidthMs < 0 || pulseWidthMs > 1000f / Frequency)
            throw new ArgumentOutOfRangeException(nameof(pulseWidthMs), "Pulse width must be between 0 and 20 milliseconds.");

        await Write((int)Math.Round(pulseWidthMs / (1000f / Frequency) * Range));
    }
}
