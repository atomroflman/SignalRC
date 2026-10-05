using System;
using System.Linq;
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using LteCar.Onboard.Control;
using LteCar.Onboard.Hardware;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Hardware
{
    public class RaspberryPiGpioManager : IModuleManager
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<RaspberryPiGpioManager> _logger;

        public RaspberryPiGpioManager(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
            _logger = serviceProvider.GetRequiredService<ILogger<RaspberryPiGpioManager>>();
        }

        public T GetModule<T>(int address) where T : class, IModule
        {
            PinFunctionFlags requiredFunction;
            if (address < 0)
            {
                _logger.LogWarning($"Invalid address {address} for module type {typeof(T).Name}. Returning null.");
                return null!;
            }
            var initType = typeof(RaspberryPiPwmPin);
            switch (typeof(T))
            {
                case Type t when t.IsAssignableTo(typeof(IPwmModule)):
                    requiredFunction = PinFunctionFlags.PWM;
                    break;
                case Type t when t.IsAssignableTo(typeof(IGpioModule)):
                    requiredFunction = PinFunctionFlags.GPIO;
                    initType = typeof(RaspberryPiGpioPin);
                    break;
                default:
                    throw new NotSupportedException($"Module type {typeof(T).Name} is not supported.");
            }

            var pinProp = typeof(RaspberryPiPinMap).GetProperty($"PIN_{address}", BindingFlags.Public | BindingFlags.Static);

            if (pinProp == null)
                return null!;

            var pinValue = pinProp.GetValue(null);
            if (pinValue == null)
                return null!;

            var pinFuncAttr = pinProp.GetCustomAttributes(typeof(PinFunctionAttribute), false)
                .OfType<PinFunctionAttribute>()
                .FirstOrDefault();

            if (pinFuncAttr == null || (pinFuncAttr.Functions & requiredFunction) != requiredFunction)
            {
                _logger.LogWarning(
                    $"Pin {address} does not support the required function {requiredFunction}. " +
                    $"Available functions: {pinFuncAttr?.Functions ?? PinFunctionFlags.None}");
                return null!;
            }

            var module = ActivatorUtilities.CreateInstance(_serviceProvider, initType, address) as T;
            return module!;
        }
    }

    public class RaspberryPiGpioPin : IGpioModule
    {
        private readonly ILogger<RaspberryPiGpioPin> _logger;
        private readonly Bash _bash;
        public int Address { get; set; }
        private bool _initialized = false;
        private bool _lastValue = false;

        public RaspberryPiGpioPin(IServiceProvider serviceProvider, int address)
        {
            _logger = serviceProvider.GetRequiredService<ILogger<RaspberryPiGpioPin>>();
            _bash = serviceProvider.GetRequiredService<Bash>();
            Address = address;
        }

        private async Task InitializePin()
        {
            if (_initialized)
                return;
            _initialized = true;
            _logger.LogInformation($"Initializing GPIO pin {Address}");
            await _bash.ExecuteAsync($"gpio -g mode {Address} out");
            _lastValue = false;
            await _bash.ExecuteAsync($"gpio -g write {Address} 0"); // Set initial value to low
        }

        public async Task SetValue(bool value)
        {
            if (!_initialized)
                await InitializePin();
            _lastValue = value;
            int gpioValue = value ? 1 : 0;
            await _bash.ExecuteAsync($"gpio -g write {Address} {gpioValue}");
        }

        public async Task<bool> GetValue()
        {
            try
            {
                var result = _bash.ExecuteAndRead($"gpio -g read {Address}");
                if (int.TryParse(result.Trim(), out int val))
                    return val != 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Error reading GPIO pin {Address}");
            }
            return _lastValue;
        }
    }
}
