using System.Device.Gpio;
using System.Device.Gpio.Drivers;
using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Control;

namespace SignalRC.Onboard.Hardware
{
    /// <summary>
    /// The Raspberry Pi's own 40-pin header. Addresses are physical header pins (1–40), not
    /// BCM numbers. Each pin can be configured under "pins": output, input (with pull resistor,
    /// debounce and edge latch) or PWM. Unconfigured pins become an output on the first write
    /// and an input on the first read.
    /// </summary>
    public class RaspberryPiGpioManager : IModuleManager, IValidatingModuleManager, IDisposable
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<RaspberryPiGpioManager> _logger;
        private readonly object _lock = new();
        private readonly Dictionary<int, RaspberryPiGpioPin> _gpioPins = new();
        private readonly Dictionary<int, IPwmModule> _pwmPins = new();
        private GpioController? _controller;
        private bool _disposed;

        /// <summary>Per-pin configuration: physical pin, mode, pull resistor, activeLow, debounce, initial state, label.</summary>
        public List<GpioPinConfig> Pins { get; set; } = new();

        /// <summary>GPIO driver. Auto picks libgpiod (v1 or v2, whichever is installed) on the header's pinctrl chip.</summary>
        public GpioDriverKind Driver { get; set; } = GpioDriverKind.Auto;

        /// <summary>gpiochip number for the libgpiod drivers; empty = the chip holding the 40-pin header.</summary>
        public int? GpioChip { get; set; }

        public RaspberryPiGpioManager(IServiceProvider serviceProvider)
        {
            _serviceProvider = serviceProvider;
            _logger = serviceProvider.GetService<ILogger<RaspberryPiGpioManager>>()
                ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<RaspberryPiGpioManager>.Instance;
        }

        public T GetModule<T>(int address) where T : class, IModule
        {
            var pin = RaspberryPiPinMap.Find(address)
                ?? throw new ArgumentOutOfRangeException(nameof(address), $"Pin {address} is not on the 40-pin header (1–40, physical numbering).");
            var config = ConfigFor(address);

            lock (_lock)
            {
                ObjectDisposedException.ThrowIf(_disposed, this);
                if (typeof(T).IsAssignableTo(typeof(IPwmModule)))
                {
                    if (!pin.Functions.HasFlag(PinFunctionFlags.PWM))
                        throw new NotSupportedException($"Pin {address} ({pin.Label}) has no hardware PWM. PWM pins: 12, 32, 33, 35.");
                    if (config != null && config.Mode != GpioPinMode.Pwm)
                        throw new InvalidOperationException($"Pin {address} is configured as {config.Mode}, not as PWM.");
                    if (_gpioPins.ContainsKey(address))
                        throw new InvalidOperationException($"Pin {address} is already used as a digital pin.");
                    if (!_pwmPins.TryGetValue(address, out var pwm))
                    {
                        pwm = ActivatorUtilities.CreateInstance<RaspberryPiPwmPin>(_serviceProvider, pin.Bcm!.Value);
                        _pwmPins[address] = pwm;
                    }
                    return pwm as T ?? throw new InvalidCastException($"{typeof(T).Name} is not provided by RaspberryPiPwmPin.");
                }

                if (typeof(T).IsAssignableTo(typeof(IGpioModule)))
                {
                    if (!pin.Functions.HasFlag(PinFunctionFlags.GPIO))
                        throw new NotSupportedException($"Pin {address} ({pin.Label}) is not a usable GPIO.");
                    if (config?.Mode == GpioPinMode.Pwm)
                        throw new InvalidOperationException($"Pin {address} is configured as PWM, not as a digital pin.");
                    if (_pwmPins.ContainsKey(address))
                        throw new InvalidOperationException($"Pin {address} is already used as a PWM output.");
                    if (!_gpioPins.TryGetValue(address, out var gpio))
                    {
                        gpio = new RaspberryPiGpioPin(this, pin.Physical, pin.Bcm!.Value, config,
                            _serviceProvider.GetService<ILogger<RaspberryPiGpioPin>>() ?? Microsoft.Extensions.Logging.Abstractions.NullLogger<RaspberryPiGpioPin>.Instance);
                        _gpioPins[address] = gpio;
                    }
                    return gpio as T ?? throw new InvalidCastException($"{typeof(T).Name} is not provided by RaspberryPiGpioPin.");
                }
            }
            throw new NotSupportedException($"Module type {typeof(T).Name} is not supported.");
        }

        public IEnumerable<string> Validate() => ValidatePins(Pins);

        /// <summary>Configuration problems of a pin list, one message each.</summary>
        public static IEnumerable<string> ValidatePins(IEnumerable<GpioPinConfig> pins)
        {
            var seen = new HashSet<int>();
            foreach (var config in pins)
            {
                var pin = RaspberryPiPinMap.Find(config.Pin);
                if (pin == null)
                {
                    yield return $"Pin {config.Pin} is not on the 40-pin header (1–40).";
                    continue;
                }
                if (!seen.Add(config.Pin))
                    yield return $"Pin {config.Pin} is configured more than once; the first entry is used.";
                if (!pin.Functions.HasFlag(PinFunctionFlags.GPIO))
                    yield return $"Pin {config.Pin} ({pin.Label}) is not a usable GPIO.";
                else if (config.Mode == GpioPinMode.Pwm && !pin.Functions.HasFlag(PinFunctionFlags.PWM))
                    yield return $"Pin {config.Pin} ({pin.Label}) has no hardware PWM.";
                if (config.Mode != GpioPinMode.Input && config.Pull != GpioPull.None)
                    yield return $"Pin {config.Pin}: pull {config.Pull} only applies to inputs and is ignored.";
                if (config.DebounceMs < 0)
                    yield return $"Pin {config.Pin}: debounceMs must not be negative.";
            }
        }

        private GpioPinConfig? ConfigFor(int physical) => Pins.FirstOrDefault(p => p.Pin == physical);

        /// <summary>The controller, opened on first use so that a dev machine without GPIO only fails when a pin is used.</summary>
        internal GpioController Controller
        {
            get
            {
                lock (_lock)
                {
                    ObjectDisposedException.ThrowIf(_disposed, this);
                    return _controller ??= CreateController();
                }
            }
        }

        // LibGpiodV2Driver is flagged experimental (SDGPIO0001). Auto does not name it: the default
        // controller picks libgpiod v1/v2 itself. It is used only when chosen explicitly.
#pragma warning disable SDGPIO0001
        private GpioController CreateController()
        {
            GpioController controller = Driver switch
            {
                GpioDriverKind.LibGpiod => new GpioController(new LibGpiodDriver(GpioChip ?? 0)),
                GpioDriverKind.LibGpiodV2 => new GpioController(new LibGpiodV2Driver(GpioChip ?? 0)),
                GpioDriverKind.SysFs => new GpioController(new SysFsDriver()),
                _ when GpioChip != null => CreateLibGpiod(GpioChip.Value),
                _ => new GpioController(),
            };
            _logger.LogInformation("GPIO controller opened ({Driver}{Chip}).", Driver, GpioChip is { } chip ? $", gpiochip{chip}" : string.Empty);
            return controller;
        }

        private static GpioController CreateLibGpiod(int chip)
        {
            try
            {
                return new GpioController(new LibGpiodV2Driver(chip));
            }
            catch (Exception)
            {
                return new GpioController(new LibGpiodDriver(chip));
            }
        }
#pragma warning restore SDGPIO0001

        public void Dispose()
        {
            List<IDisposable> pins;
            GpioController? controller;
            lock (_lock)
            {
                if (_disposed) return;
                _disposed = true;
                pins = _gpioPins.Values.Cast<IDisposable>().Concat(_pwmPins.Values.OfType<IDisposable>()).ToList();
                _gpioPins.Clear();
                _pwmPins.Clear();
                controller = _controller;
                _controller = null;
            }
            foreach (var pin in pins)
            {
                try { pin.Dispose(); }
                catch (Exception ex) { _logger.LogWarning(ex, "Closing a GPIO pin failed."); }
            }
            controller?.Dispose();
            GC.SuppressFinalize(this);
        }
    }

    public enum GpioDriverKind { Auto, LibGpiod, LibGpiodV2, SysFs }

    public enum GpioPinMode { Output, Input, Pwm }

    public enum GpioPull { None, Up, Down }

    /// <summary>Configuration of one header pin of the RaspberryPiGpioManager.</summary>
    public class GpioPinConfig
    {
        /// <summary>Physical header pin, 1–40.</summary>
        public int Pin { get; set; }
        public GpioPinMode Mode { get; set; } = GpioPinMode.Output;
        /// <summary>Internal pull resistor of an input.</summary>
        public GpioPull Pull { get; set; } = GpioPull.None;
        /// <summary>Logical "on" is electrical low (e.g. a switch to GND with pull-up).</summary>
        public bool ActiveLow { get; set; }
        /// <summary>An input level counts only once it was stable this long.</summary>
        public int DebounceMs { get; set; }
        /// <summary>Logical level an output starts with.</summary>
        public bool InitialState { get; set; }
        /// <summary>Free text shown in the pin editor, e.g. "Endschalter vorne".</summary>
        public string? Label { get; set; }
    }

    /// <summary>
    /// One digital header pin. Inputs are watched with edge events: a pulse shorter than the
    /// telemetry interval still shows up as <see cref="GpioReading.Latched"/>, and debouncing
    /// works on the edge timestamps instead of on polled samples.
    /// </summary>
    public sealed class RaspberryPiGpioPin : IGpioModule, IDisposable
    {
        private readonly RaspberryPiGpioManager _manager;
        private readonly GpioPinConfig? _config;
        private readonly ILogger _logger;
        private readonly object _lock = new();

        private bool _open;
        private bool _isInput;
        private bool _events;
        private bool _disposed;

        // Debounce state, logical levels (activeLow applied).
        private bool _stable;
        private bool _pending;
        private long _pendingSince;
        private bool _latched;
        private long _edges;
        private bool _lastWritten;

        public int Physical { get; }
        public int Bcm { get; }
        public int Address => Physical;

        internal RaspberryPiGpioPin(RaspberryPiGpioManager manager, int physical, int bcm, GpioPinConfig? config, ILogger logger)
        {
            _manager = manager;
            Physical = physical;
            Bcm = bcm;
            _config = config;
            _logger = logger;
        }

        private bool ActiveLow => _config?.ActiveLow ?? false;
        private long DebounceTicks => (_config?.DebounceMs ?? 0) * Stopwatch.Frequency / 1000;

        public override string ToString() => $"GPIO pin {Physical} (BCM {Bcm})";

        public Task SetValue(bool value)
        {
            lock (_lock)
            {
                EnsureOpen(forWrite: true);
                _manager.Controller.Write(Bcm, ToPin(value));
                if (value != _lastWritten) _edges++;
                _lastWritten = value;
            }
            return Task.CompletedTask;
        }

        public Task<bool> GetValue()
        {
            lock (_lock)
            {
                EnsureOpen(forWrite: false);
                return Task.FromResult(_isInput ? CurrentInput() : FromPin(_manager.Controller.Read(Bcm)));
            }
        }

        public Task<GpioReading> ReadAsync()
        {
            lock (_lock)
            {
                EnsureOpen(forWrite: false);
                if (!_isInput)
                {
                    var output = FromPin(_manager.Controller.Read(Bcm));
                    return Task.FromResult(new GpioReading(output, output, _edges, false, true));
                }
                var value = CurrentInput();
                var latched = _latched || value;
                _latched = false;
                return Task.FromResult(new GpioReading(value, latched, _edges, true, true));
            }
        }

        /// <summary>Debounced input level now; without edge events the raw level.</summary>
        private bool CurrentInput()
        {
            if (!_events)
            {
                var raw = FromPin(_manager.Controller.Read(Bcm));
                if (raw != _stable) _edges++;
                _stable = raw;
                return raw;
            }
            Settle(Stopwatch.GetTimestamp());
            return _stable;
        }

        /// <summary>Accepts the pending level once it has been stable for the debounce time.</summary>
        private void Settle(long now)
        {
            if (_pending == _stable || now - _pendingSince < DebounceTicks) return;
            _stable = _pending;
            _edges++;
            if (_stable) _latched = true;
        }

        private void OnEdge(object sender, PinValueChangedEventArgs args)
        {
            lock (_lock)
            {
                if (_disposed || !_isInput) return;
                var now = Stopwatch.GetTimestamp();
                // The previous level ends here: count it if it lasted long enough.
                Settle(now);
                _pending = FromPin(args.ChangeType == PinEventTypes.Rising ? PinValue.High : PinValue.Low);
                _pendingSince = now;
                if (DebounceTicks == 0) Settle(now);
            }
        }

        private void EnsureOpen(bool forWrite)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var mode = _config?.Mode;
            if (forWrite && mode == GpioPinMode.Input)
                throw new InvalidOperationException($"Pin {Physical} is configured as input and cannot be written.");

            var wantInput = mode switch
            {
                GpioPinMode.Input => true,
                GpioPinMode.Output => false,
                // Unconfigured: the first use decides, a later write turns an input into an output.
                _ => forWrite ? false : !_open || _isInput,
            };
            if (_open && wantInput == _isInput) return;

            var controller = _manager.Controller;
            if (wantInput)
            {
                var pinMode = (_config?.Pull ?? GpioPull.None) switch
                {
                    GpioPull.Up => PinMode.InputPullUp,
                    GpioPull.Down => PinMode.InputPullDown,
                    _ => PinMode.Input,
                };
                if (pinMode != PinMode.Input && !controller.IsPinModeSupported(Bcm, pinMode))
                {
                    _logger.LogWarning("Pin {Pin}: the GPIO driver does not support {Mode}; using a plain input. Add an external resistor.", Physical, pinMode);
                    pinMode = PinMode.Input;
                }
                if (!controller.IsPinOpen(Bcm)) controller.OpenPin(Bcm, pinMode);
                else controller.SetPinMode(Bcm, pinMode);
                _isInput = true;
                _open = true;
                _stable = _pending = FromPin(controller.Read(Bcm));
                _pendingSince = Stopwatch.GetTimestamp();
                try
                {
                    controller.RegisterCallbackForPinValueChangedEvent(Bcm, PinEventTypes.Rising | PinEventTypes.Falling, OnEdge);
                    _events = true;
                }
                catch (Exception ex)
                {
                    _events = false;
                    _logger.LogWarning(ex, "Pin {Pin}: no edge events from the GPIO driver; the input is polled, short pulses and debounce are lost.", Physical);
                }
                _logger.LogInformation("{Pin} opened as input ({Mode}, activeLow {ActiveLow}, debounce {Debounce} ms).", this, pinMode, ActiveLow, _config?.DebounceMs ?? 0);
            }
            else
            {
                StopEvents(controller);
                var initial = _open ? _lastWritten : _config?.InitialState ?? false;
                if (!controller.IsPinOpen(Bcm)) controller.OpenPin(Bcm, PinMode.Output, ToPin(initial));
                else
                {
                    controller.SetPinMode(Bcm, PinMode.Output);
                    controller.Write(Bcm, ToPin(initial));
                }
                _lastWritten = initial;
                _isInput = false;
                _open = true;
                _logger.LogInformation("{Pin} opened as output (initial {Initial}, activeLow {ActiveLow}).", this, initial, ActiveLow);
            }
        }

        private void StopEvents(GpioController controller)
        {
            if (!_events) return;
            try { controller.UnregisterCallbackForPinValueChangedEvent(Bcm, OnEdge); }
            catch (Exception ex) { _logger.LogDebug(ex, "Unregistering the edge callback of {Pin} failed.", this); }
            _events = false;
        }

        private PinValue ToPin(bool logical) => logical ^ ActiveLow ? PinValue.High : PinValue.Low;
        private bool FromPin(PinValue value) => (value == PinValue.High) ^ ActiveLow;

        public void Dispose()
        {
            lock (_lock)
            {
                if (_disposed) return;
                _disposed = true;
                if (!_open) return;
                try
                {
                    var controller = _manager.Controller;
                    StopEvents(controller);
                    if (controller.IsPinOpen(Bcm)) controller.ClosePin(Bcm);
                }
                catch (ObjectDisposedException)
                {
                    // The manager is going away and takes the controller with it.
                }
            }
        }
    }
}
