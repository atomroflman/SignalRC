using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Hardware;

// GPIO / PWM telemetry without hardware: the pin map, the option binding and
// validation of RaspberryPiGpioManager, the default manager of the factory,
// and the readers and GpioOutput against fake modules. Opening real pins
// (libgpiod, PCA9685 over I2C) is covered only on the vehicle.
public class GpioTelemetryTests
{
    [Fact]
    public void PinMapIsPhysicalToBcm()
    {
        Assert.Equal(40, RaspberryPiPinMap.Pins.Count);
        Assert.Equal(17, RaspberryPiPinMap.Find(11)!.Bcm);
        Assert.Null(RaspberryPiPinMap.Find(6)!.Bcm);
        Assert.Null(RaspberryPiPinMap.Find(41));
        Assert.Equal(new[] { 12, 32, 33, 35 },
            RaspberryPiPinMap.Pins.Where(p => p.Functions.HasFlag(PinFunctionFlags.PWM)).Select(p => p.Physical));
        // Flags are real flags now: plain GPIO pins are not PWM pins.
        Assert.False(RaspberryPiPinMap.Find(11)!.Functions.HasFlag(PinFunctionFlags.PWM));
        Assert.True(RaspberryPiPinMap.Find(8)!.Functions.HasFlag(PinFunctionFlags.GPIO));
        Assert.False(RaspberryPiPinMap.Find(27)!.Functions.HasFlag(PinFunctionFlags.GPIO));
    }

    [Fact]
    public void PinsOptionBindsFromJsonLikeMaps()
    {
        var manager = new RaspberryPiGpioManager(Services());
        var options = new Dictionary<string, object>
        {
            ["pins"] = new List<object>
            {
                new Dictionary<string, object> { ["pin"] = 11, ["mode"] = "Input", ["pull"] = "Up", ["activeLow"] = true, ["debounceMs"] = 20 },
                new Dictionary<string, object> { ["pin"] = 13, ["mode"] = "output", ["initialState"] = true, ["device"] = "Relay" },
            },
            ["driver"] = "Auto",
        };
        var problems = ChannelOptionBinder.Apply(manager, options, NullLogger.Instance, "test", warnUnknown: false);
        Assert.Empty(problems);
        Assert.Equal(2, manager.Pins.Count);
        Assert.Equal(GpioPinMode.Input, manager.Pins[0].Mode);
        Assert.Equal(GpioPull.Up, manager.Pins[0].Pull);
        Assert.True(manager.Pins[0].ActiveLow);
        Assert.Equal(20, manager.Pins[0].DebounceMs);
        Assert.True(manager.Pins[1].InitialState);
        Assert.Equal(ConnectedDevice.Relay, manager.Pins[1].Device);
        Assert.Equal(ConnectedDevice.Auto, manager.Pins[0].Device);
        Assert.Empty(manager.Validate());
    }

    [Fact]
    public void PcaChannelConfigsBindAndValidate()
    {
        var pca = new Pca9685PwmExtension(Services());
        var options = new Dictionary<string, object>
        {
            ["channels"] = new List<object>
            {
                new Dictionary<string, object> { ["channel"] = 4, ["device"] = "Led", ["label"] = "Blinker links" },
                new Dictionary<string, object> { ["channel"] = 4, ["device"] = "servo" },
                new Dictionary<string, object> { ["channel"] = 16 },
            },
        };
        Assert.Empty(ChannelOptionBinder.Apply(pca, options, NullLogger.Instance, "test", warnUnknown: true));
        Assert.Equal(ConnectedDevice.Led, pca.Channels[0].Device);
        Assert.Equal("Blinker links", pca.Channels[0].Label);
        Assert.Equal(ConnectedDevice.Servo, pca.Channels[1].Device);
        var problems = pca.Validate().ToList();
        Assert.Contains(problems, p => p.Contains("more than once"));
        Assert.Contains(problems, p => p.Contains("0-15"));
    }

    [Fact]
    public void ValidationNamesEveryBadPin()
    {
        var problems = RaspberryPiGpioManager.ValidatePins(
        [
            new GpioPinConfig { Pin = 6 },
            new GpioPinConfig { Pin = 11, Mode = GpioPinMode.Pwm },
            new GpioPinConfig { Pin = 13 },
            new GpioPinConfig { Pin = 13 },
            new GpioPinConfig { Pin = 15, Pull = GpioPull.Up },
            new GpioPinConfig { Pin = 50 },
        ]).ToList();
        Assert.Contains(problems, p => p.Contains("Pin 6") && p.Contains("not a usable GPIO"));
        Assert.Contains(problems, p => p.Contains("Pin 11") && p.Contains("no hardware PWM"));
        Assert.Contains(problems, p => p.Contains("Pin 13") && p.Contains("more than once"));
        Assert.Contains(problems, p => p.Contains("Pin 15") && p.Contains("only applies to inputs"));
        Assert.Contains(problems, p => p.Contains("Pin 50"));
    }

    [Fact]
    public void GetModuleRejectsWrongUseBeforeTouchingHardware()
    {
        var manager = new RaspberryPiGpioManager(Services())
        {
            Pins = [new GpioPinConfig { Pin = 12, Mode = GpioPinMode.Pwm }, new GpioPinConfig { Pin = 11, Mode = GpioPinMode.Input }],
        };
        Assert.Throws<ArgumentOutOfRangeException>(() => manager.GetModule<IGpioModule>(41));
        Assert.Throws<NotSupportedException>(() => manager.GetModule<IGpioModule>(6));
        Assert.Throws<NotSupportedException>(() => manager.GetModule<IPwmModule>(11));
        Assert.Throws<InvalidOperationException>(() => manager.GetModule<IGpioModule>(12));
        // Same address, same instance: control and reader share the pin.
        Assert.Same(manager.GetModule<IGpioModule>(11), manager.GetModule<IGpioModule>(11));
        Assert.Same(manager.GetModule<IPwmModule>(12), manager.GetModule<IPwmModule>(12));
        Assert.IsType<RaspberryPiPwmPin>(manager.GetModule<IPwmModule>(12));
        Assert.Equal(18, ((RaspberryPiPwmPin)manager.GetModule<IPwmModule>(12)).PinNumber);
    }

    [Fact]
    public void FactoryBuildsDefaultFromItsEntryOrBare()
    {
        var map = new ChannelMap();
        var services = Services(map);
        var factory = new ModuleManagerFactory(services.GetRequiredService<ILoggerFactory>(), services, map);
        var bare = Assert.IsType<RaspberryPiGpioManager>(factory.Create("default"));
        Assert.Empty(bare.Pins);

        map.PinManagers["default"] = new PinManagerMapItem
        {
            Type = "RaspberryPiGpioManager",
            Options = new() { ["pins"] = new List<object> { new Dictionary<string, object> { ["pin"] = 7, ["mode"] = "Input" } } },
        };
        factory.Invalidate("default");
        var configured = Assert.IsType<RaspberryPiGpioManager>(factory.Create("default"));
        Assert.NotSame(bare, configured);
        Assert.Equal(7, Assert.Single(configured.Pins).Pin);
    }

    [Fact]
    public void PwmReadbackUnits()
    {
        var r = new PwmReadback(2048, 4096, 50f, true, null);
        Assert.Equal(0.5, r.DutyCycle, 6);
        Assert.Equal(10, r.PulseWidthMs, 6);
    }

    [Fact]
    public async Task GpioReaderReportsLatchedStateFromTheChannelPin()
    {
        var pin = new FakeGpio { Reading = new GpioReading(false, true, 3, true, true) };
        var factory = new FakeFactory(pin, new FakePwm());
        var reader = new GpioPinReader(NullLogger<GpioPinReader>.Instance, factory);
        ((IPinAddressedReader)reader).Bind("gpio", 11);

        var s = await reader.ReadAllSamplesAsync("door");
        Assert.Equal(new TelemetrySample("1", TelemetrySampleState.Valid, 0), s!["door"]);
        Assert.Equal(("gpio", 11), factory.LastRequest);

        reader.Latch = false;
        Assert.Equal("0", (await reader.ReadAllSamplesAsync("door"))!["door"].Value);
        reader.Report = GpioReport.Edges;
        Assert.Equal("3", (await reader.ReadAllSamplesAsync("door"))!["door"].Value);
    }

    [Fact]
    public async Task ReaderWithoutAddressIsAnError()
    {
        var reader = new GpioPinReader(NullLogger<GpioPinReader>.Instance, new FakeFactory(new FakeGpio(), new FakePwm()));
        ((IPinAddressedReader)reader).Bind("default", null);
        Assert.Equal(TelemetrySampleState.Error, (await reader.ReadAllSamplesAsync("x"))!["x"].State);
    }

    [Fact]
    public async Task PwmReaderUnitsAndQuality()
    {
        var pwm = new FakePwm { Readback = new PwmReadback(1024, 4096, 50f, true, null) };
        var reader = new PwmOutputReader(NullLogger<PwmOutputReader>.Instance, new FakeFactory(new FakeGpio(), pwm));
        ((IPinAddressedReader)reader).Bind("pca", 3);
        Assert.Equal(new TelemetrySample("25", TelemetrySampleState.Valid, 0), (await reader.ReadAllSamplesAsync("l"))!["l"]);
        reader.Report = PwmReport.PulseWidthUs;
        Assert.Equal("5000", (await reader.ReadAllSamplesAsync("l"))!["l"].Value);

        pwm.Readback = new PwmReadback(10, 2000, 50f, false, null);
        Assert.Equal(TelemetrySampleState.Unchecked, (await reader.ReadAllSamplesAsync("l"))!["l"].State);
        pwm.Readback = new PwmReadback(0, 4096, 50f, true, "asleep");
        Assert.Equal(TelemetrySampleState.Error, (await reader.ReadAllSamplesAsync("l"))!["l"].State);
    }

    [Fact]
    public void GpioOutputSwitchesAtThresholdAndOnRelease()
    {
        var pin = new FakeGpio();
        var control = new GpioOutput(NullLogger<GpioOutput>.Instance) { Address = 11, PinManager = new FakeFactory(pin, new FakePwm()) };
        control.Initialize();
        control.OnControlRecived(0.7m);
        control.OnControlRecived(0.9m);
        control.OnControlRecived(0.2m);
        control.OnControlRecived(1m);
        control.OnControlReleased();
        Assert.Equal(new[] { true, false, true, false }, pin.Writes);

        control.ReleaseState = GpioReleaseState.Keep;
        control.OnControlRecived(1m);
        control.OnControlReleased();
        Assert.True(pin.Writes[^1]);
    }

    private static IServiceProvider Services(ChannelMap? map = null) => new ServiceCollection()
        .AddLogging()
        .AddSingleton(map ?? new ChannelMap())
        .AddTransient<Bash>()
        .BuildServiceProvider();

    private sealed class FakeGpio : IGpioModule
    {
        public List<bool> Writes { get; } = new();
        public GpioReading Reading { get; set; }
        public Task SetValue(bool value) { Writes.Add(value); return Task.CompletedTask; }
        public Task<bool> GetValue() => Task.FromResult(Reading.Value);
        public Task<GpioReading> ReadAsync() => Task.FromResult(Reading);
    }

    private sealed class FakePwm : IPwmModule
    {
        public PwmReadback Readback { get; set; }
        public Task SetPwmCyclePercentage(float value) => Task.CompletedTask;
        public Task<float> GetPwmValue() => Task.FromResult(0f);
        public Task SetServoPosition(float position) => Task.CompletedTask;
        public Task SetPulseWidthMilliseconds(float pulseWidthMs) => Task.CompletedTask;
        public Task<PwmReadback> ReadOutputAsync() => Task.FromResult(Readback);
    }

    private sealed class FakeFactory(IGpioModule gpio, IPwmModule pwm) : IModuleManagerFactory, IModuleManager
    {
        private string _name = "";
        public (string, int) LastRequest { get; private set; }
        public IModuleManager Create(string name) { _name = name; return this; }
        public T GetModule<T>(int address) where T : class, IModule
        {
            LastRequest = (_name, address);
            return (typeof(T) == typeof(IGpioModule) ? gpio as T : pwm as T)!;
        }
    }
}
