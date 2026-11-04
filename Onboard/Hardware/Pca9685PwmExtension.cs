using System;
using System.Device.I2c;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware
{
    /// <summary>
    /// PCA9685 16-channel PWM board over I2C (addresses 0–15 are the channels). Runs at 50 Hz
    /// for servos; outputs can be read back from the chip registers for telemetry.
    /// </summary>
    public class Pca9685PwmExtension : IModuleManager, IDisposable
    {
        public const int Channels = 16;
        public const int Resolution = 4096;
        private const byte Prescale = 0x79;
        /// <summary>25 MHz internal clock / (4096 × (prescale + 1)).</summary>
        public const float FrequencyHz = 25_000_000f / (Resolution * (Prescale + 1));

        private readonly Dictionary<int, Pca9685PwmExtensionPwmModule> _modules = new();
        private bool _initialized;
        private I2cDevice? _device;
        private readonly object _initLock = new();
        private readonly object _deviceLock = new();
        private const int PCA9685_DEFAULT_ADDRESS = 0x40; // Default I2C address for PCA9685

        public ILogger<Pca9685PwmExtension> Logger { get; }
        /// <summary>Address offset set by the board's solder jumpers; the I2C address is 0x40 + this.</summary>
        public int BoardAddress { get; set; }
        /// <summary>I2C bus number (/dev/i2c-N).</summary>
        public int I2cBus { get; set; } = 1;
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
                WriteRegisterUnchecked(0xFE, Prescale); // ~50 Hz
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

        /// <summary>
        /// Reads the four channel registers and MODE1. MODE1 bit 4 (SLEEP) set means the chip lost
        /// its configuration, typically a brown-out reset: the outputs are off whatever was written.
        /// </summary>
        internal (int On, int Off, bool FullOn, bool FullOff, bool Asleep) ReadChannelRegisters(int regBase)
        {
            EnsureInitialized();
            Span<byte> channel = stackalloc byte[4];
            Span<byte> mode1 = stackalloc byte[1];
            lock (_deviceLock)
            {
                Device.WriteRead(stackalloc byte[] { (byte)regBase }, channel);
                Device.WriteRead(stackalloc byte[] { 0x00 }, mode1);
            }
            return (
                channel[0] | (channel[1] & 0x0F) << 8,
                channel[2] | (channel[3] & 0x0F) << 8,
                (channel[1] & 0x10) != 0,
                (channel[3] & 0x10) != 0,
                (mode1[0] & 0x10) != 0);
        }

        public T GetModule<T>(int address) where T : class, IModule
        {
            if (!typeof(T).IsAssignableTo(typeof(IPwmModule)))
                throw new InvalidOperationException($"Module type {typeof(T).Name} is not a PWM module. Only IPwmModule is supported.");
            if (address < 0 || address >= Channels)
                throw new ArgumentOutOfRangeException(nameof(address), "Address must be between 0 and 15.");
            EnsureInitialized();

            // One module per channel: a control and a telemetry reader on the same channel share it.
            lock (_modules)
            {
                if (!_modules.TryGetValue(address, out var module))
                {
                    Logger.LogInformation("Creating PWM module for channel {Address}", address);
                    module = new Pca9685PwmExtensionPwmModule(this, address);
                    _modules[address] = module;
                }
                return module as T ?? throw new InvalidOperationException("Failed to create PWM module.");
            }
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
        private const int PWM_RESOLUTION = Pca9685PwmExtension.Resolution;

        private readonly Pca9685PwmExtension _extension;
        private readonly int _channel;
        private readonly int _regBase;
        private int _lastCounts;

        public Pca9685PwmExtensionPwmModule(Pca9685PwmExtension extension, int channel)
        {
            _extension = extension;
            _channel = channel;
            _regBase = 0x06 + 4 * channel; // Base register for the channel
        }

        public override string ToString() => $"PCA9685 channel {_channel}";

        public Task SetServoPosition(float position)
        {
            position = Math.Clamp(position, -1f, 1f);
            var pwmValue = (int)Math.Round((SERVO_MAX_PULSE - SERVO_MIN_PULSE) * ((position + 1f) / 2f) + SERVO_MIN_PULSE);
            SendPwmUpdate(pwmValue);
            return Task.CompletedTask;
        }

        public Task SetPwmCyclePercentage(float value)
        {
            value = Math.Clamp(value, 0f, 1f);
            int pwmValue = (int)Math.Round(value * (PWM_RESOLUTION - 1));
            SendPwmUpdate(pwmValue);
            return Task.CompletedTask;
        }

        public Task SetPulseWidthMilliseconds(float pulseWidthMs)
        {
            float periodMs = 1000f / Pca9685PwmExtension.FrequencyHz;
            if (pulseWidthMs < 0 || pulseWidthMs > periodMs)
                throw new ArgumentOutOfRangeException(nameof(pulseWidthMs), $"Pulse width must be between 0 and {periodMs} ms.");

            int pwmValue = (int)Math.Round((PWM_RESOLUTION - 1) * (pulseWidthMs / periodMs));
            SendPwmUpdate(pwmValue);
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
               "Setting channel {Channel} to PWM {PWM} on Register 0x{Reg:X2}",
               _channel,
               pwmValue,
               _regBase
           );

            _extension.WriteChannelRegisters(_regBase, onLow, onHigh, offLow, offHigh);
            _lastCounts = pwmValue;
        }

        /// <summary>Duty cycle 0–1 of the last write.</summary>
        public Task<float> GetPwmValue() => Task.FromResult(_lastCounts / (float)PWM_RESOLUTION);

        public Task<PwmReadback> ReadOutputAsync()
        {
            var r = _extension.ReadChannelRegisters(_regBase);
            var counts = r.FullOff ? 0 : r.FullOn ? PWM_RESOLUTION : ((r.Off - r.On) % PWM_RESOLUTION + PWM_RESOLUTION) % PWM_RESOLUTION;
            var fault = r.Asleep ? "PCA9685 is in sleep mode (reset, e.g. by a brown-out): outputs are off" : null;
            return Task.FromResult(new PwmReadback(counts, PWM_RESOLUTION, Pca9685PwmExtension.FrequencyHz, true, fault));
        }
    }
}
