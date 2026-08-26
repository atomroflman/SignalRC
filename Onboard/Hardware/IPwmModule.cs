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
        /// Gets the current PWM value.
        /// </summary>
        /// <returns>The current PWM value.</returns>
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
    }
}