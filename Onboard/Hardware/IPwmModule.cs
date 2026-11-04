using System;
using System.Threading.Tasks;

namespace SignalRC.Onboard.Hardware
{
    public interface IPwmModule : IModule
    {
        /// <summary>
        /// Sets the PWM value.
        /// </summary>
        /// <param name="value">The value to set, typically between 0 and 1.</param>
        Task SetPwmCyclePercentage(float value);

        /// <summary>
        /// The current duty cycle, 0–1, whatever method set it.
        /// </summary>
        Task<float> GetPwmValue();

        /// <summary>
        /// Sets the servo position.
        /// </summary>
        /// <param name="position">The position to set, typically between -1 and 1.</param>
        /// <returns>A task representing the asynchronous operation.</returns>
        Task SetServoPosition(float position);

        /// <summary>
        /// Sets the pulse width in milliseconds for a PWM channel.
        /// The period is determined by the frequency (e.g., 20ms at 50Hz).
        /// </summary>
        /// <param name="pulseWidthMs">Pulse width in milliseconds (e.g., 1.5 for 1.5ms)</param>
        /// <returns>A task representing the asynchronous operation.</returns>
        /// <exception cref="ArgumentOutOfRangeException">Thrown if the pulse width is out of range.</exception>
        Task SetPulseWidthMilliseconds(float pulseWidthMs);

        /// <summary>
        /// What the output currently drives, for telemetry. Boards that can be
        /// read back (PCA9685) report the register contents; others report the
        /// last value written with <see cref="PwmReadback.Measured"/> false.
        /// </summary>
        Task<PwmReadback> ReadOutputAsync() =>
            GetPwmValue().ContinueWith(t => new PwmReadback((int)Math.Round(t.Result * 4095), 4096, 50f, false, null));
    }

    /// <param name="Counts">High time in counts of <paramref name="Resolution"/>.</param>
    /// <param name="Resolution">Counts per period.</param>
    /// <param name="FrequencyHz">PWM frequency.</param>
    /// <param name="Measured">Read back from the hardware rather than cached.</param>
    /// <param name="Fault">Set when the readback shows the hardware is not driving the output (e.g. PCA9685 in sleep after a brown-out).</param>
    public readonly record struct PwmReadback(int Counts, int Resolution, float FrequencyHz, bool Measured, string? Fault)
    {
        public double DutyCycle => Resolution <= 0 ? 0 : Math.Clamp((double)Counts / Resolution, 0, 1);
        public double PulseWidthMs => FrequencyHz <= 0 ? 0 : DutyCycle * 1000.0 / FrequencyHz;
    }
}
