using System;
using System.Device.I2c;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Hardware
{
    /// <summary>
    /// Maps normalized float values (-1 to 1) to PCA9685 PWM outputs using direct I2C access.
    /// </summary>
    public class Pca9685PwmExtension : IModuleManager, IDisposable
    {
        private bool _initialized;
        private I2cDevice? _device;
        private readonly object _initLock = new();
        private readonly object _deviceLock = new();
        private const int PCA9685_DEFAULT_ADDRESS = 0x40; // Default I2C address for PCA9685

        public ILogger<Pca9685PwmExtension> Logger { get; }
        public int BoardAddress { get; set; }
        public int I2cBus { get; set; } = 1; // Default I2C bus
        public int BoardI2cAddress => BoardAddress + PCA9685_DEFAULT_ADDRESS;

        public Pca9685PwmExtension(IServiceProvider provider)
        {
            Logger = provider.GetRequiredService<ILogger<Pca9685PwmExtension>>();
        }

        private I2cDevice Device => _device ?? throw new InvalidOperationException("PCA9685 device not initialized.");

        private void EnsureInitialized()
        {
            if (_initialized)
                return;

            lock (_initLock)
            {
                if (_initialized)
                    return;

                if (BoardAddress < 0 || BoardAddress > 127)
                    throw new ArgumentOutOfRangeException(nameof(BoardAddress), "Board address must be between 0 and 127.");
                if (I2cBus < 0 || I2cBus > 15)
                    throw new ArgumentOutOfRangeException(nameof(I2cBus), "I2C bus number must be between 0 and 15.");

                var settings = new I2cConnectionSettings(I2cBus, BoardI2cAddress);
                _device = I2cDevice.Create(settings);

                WriteRegisterUnchecked(0x00, 0x10); // Sleep
                WriteRegisterUnchecked(0xFE, 0x79); // Prescale for ~50Hz
                WriteRegisterUnchecked(0x00, 0x20); // Wake up, auto increment

                _initialized = true;
                Logger.LogInformation("PCA9685 initialized on I2C bus {I2cBus} at address 0x{BoardAddress:X2} (@I2C: {BoardI2cAddress})", I2cBus, BoardAddress, BoardI2cAddress);
            }
        }

        private void WriteRegisterUnchecked(byte register, byte value)
        {
            Span<byte> buffer = stackalloc byte[2];
            buffer[0] = register;
            buffer[1] = value;

            lock (_deviceLock)
            {
                Device.Write(buffer);
            }
        }

        internal void WriteChannelRegisters(int regBase, byte onLow, byte onHigh, byte offLow, byte offHigh)
        {
            EnsureInitialized();

            Span<byte> buffer = stackalloc byte[5];
            buffer[0] = (byte)regBase;
            buffer[1] = onLow;
            buffer[2] = onHigh;
            buffer[3] = offLow;
            buffer[4] = offHigh;

            lock (_deviceLock)
            {
                Device.Write(buffer);
            }
        }

        public T GetModule<T>(int address) where T : class, IModule
        {
            EnsureInitialized();

            Logger.LogInformation("Creating PWM module of type {ModuleType} at address {Address}", typeof(T).Name, address);
            if (!typeof(T).IsAssignableTo(typeof(IPwmModule)))
                throw new InvalidOperationException($"Module type {typeof(T).Name} is not a PWM module. Only IPwmModule is supported.");
            if (address < 0 || address > 15)
                throw new ArgumentOutOfRangeException(nameof(address), "Address must be between 0 and 15.");

            return new Pca9685PwmExtensionPwmModule(this, address) as T ?? throw new InvalidOperationException("Failed to create PWM module.");
        }

        public void Dispose()
        {
            lock (_deviceLock)
            {
                _device?.Dispose();
                _device = null;
                _initialized = false;
            }
        }
    }

    public class Pca9685PwmExtensionPwmModule : IPwmModule
    {
        private const int SERVO_MIN_PULSE = 105; // Minimum pulse width in counts
        private const int SERVO_MAX_PULSE = 550; // Maximum pulse width in counts
        private const int PWM_RESOLUTION = 4096;
        private const float PWM_FREQUENCY = 50f; // PWM frequency in Hz

        private readonly Pca9685PwmExtension _extension;
        private readonly int _channel;
        private readonly int _regBase;
        private float _lastValue;

        public Pca9685PwmExtensionPwmModule(Pca9685PwmExtension extension, int channel)
        {
            _extension = extension;
            _channel = channel;
            _regBase = 0x06 + 4 * channel; // Base register for the channel
        }

        public Task SetServoPosition(float position)
        {
            position = Math.Clamp(position, -1f, 1f);
            var pwmValue = (int)Math.Round((SERVO_MAX_PULSE - SERVO_MIN_PULSE) * ((position + 1f) / 2f) + SERVO_MIN_PULSE);
            SendPwmUpdate(pwmValue);
            _lastValue = position;
            return Task.CompletedTask;
        }

        public Task SetPwmCyclePercentage(float value)
        {
            value = Math.Clamp(value, 0f, 1f);
            int pwmValue = (int)Math.Round(value * (PWM_RESOLUTION - 1));
            SendPwmUpdate(pwmValue);
            _lastValue = value;
            return Task.CompletedTask;
        }

        public Task SetPulseWidthMilliseconds(float pulseWidthMs)
        {
            float periodMs = 1000f / PWM_FREQUENCY;
            if (pulseWidthMs < 0 || pulseWidthMs > periodMs)
                throw new ArgumentOutOfRangeException(nameof(pulseWidthMs), $"Pulse width must be between 0 and {periodMs} ms.");

            int pwmValue = (int)Math.Round((PWM_RESOLUTION - 1) * (pulseWidthMs / periodMs));
            SendPwmUpdate(pwmValue);
            _lastValue = pwmValue / (PWM_RESOLUTION - 1f);
            return Task.CompletedTask;
        }

        private void SendPwmUpdate(int pwmValue)
        {
            pwmValue = Math.Clamp(pwmValue, 0, PWM_RESOLUTION - 1);
            byte onLow = 0x00;
            byte onHigh = 0x00;
            byte offLow = (byte)(pwmValue & 0xFF);
            byte offHigh = (byte)((pwmValue >> 8) & 0x0F);

            _extension.Logger?.LogDebug(
               "Setting channel {Channel} to PWM {PWM} (Input={Input}) on Register 0x{Reg:X2}",
               _channel,
               pwmValue,
               pwmValue,
               _regBase
           );

            _extension.WriteChannelRegisters(_regBase, onLow, onHigh, offLow, offHigh);
        }

        public Task<float> GetPwmValue() => Task.FromResult(_lastValue);
    }
}