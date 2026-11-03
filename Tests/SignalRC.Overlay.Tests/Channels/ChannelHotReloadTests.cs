using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Can;
using SignalRC.Onboard.Services;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Channels;

/// <summary>
/// Changed channels are rebuilt without a restart, and a broken one is reported in the
/// channel health instead of throwing into the onboard.
/// </summary>
public class ChannelHotReloadTests
{
    [Fact]
    public void BrokenControlIsReportedAndTheOthersRun()
    {
        var (map, services) = Setup();
        map.ControlChannels["ok"] = Control("LoggingOnly");
        map.ControlChannels["bad"] = Control("LoggingOnly", pinManager: "missing");
        var controls = services.GetRequiredService<ControlExecutionService>();
        var health = services.GetRequiredService<ChannelHealthService>();

        controls.Initialize();
        controls.SetControl("bad", 1);
        controls.SetControl("ok", 1);

        var entry = Assert.Single(health.Snapshot().Entries);
        Assert.Equal(("control", "bad", ChannelHealthEntry.Error), (entry.Kind, entry.Name, entry.State));
        Assert.Contains("missing", entry.Message);
    }

    [Fact]
    public void ReloadAppliesTheFixedChannel()
    {
        var (map, services) = Setup();
        map.ControlChannels["drive"] = Control("TrackThrottle");
        var factory = (FakeFactory)services.GetRequiredService<IModuleManagerFactory>();
        factory.Broken = true;
        var controls = services.GetRequiredService<ControlExecutionService>();
        var health = services.GetRequiredService<ChannelHealthService>();

        controls.Initialize();
        Assert.Contains("no bus", Assert.Single(health.Snapshot().Entries).Message);

        factory.Broken = false;
        controls.Reload("drive");
        Assert.Empty(health.Snapshot().Entries);
        controls.SetControl("drive", 0.5m);
        Assert.Equal(0.5f, factory.Input.Value);
    }

    [Fact]
    public void ReloadReleasesTheOldControl()
    {
        var (map, services) = Setup();
        map.ControlChannels["drive"] = Control("TrackThrottle");
        var factory = (FakeFactory)services.GetRequiredService<IModuleManagerFactory>();
        var controls = services.GetRequiredService<ControlExecutionService>();
        controls.Initialize();
        controls.SetControl("drive", 1);

        map.ControlChannels.Remove("drive");
        controls.Reload("drive");

        Assert.True(factory.Input.Released);
        controls.SetControl("drive", 1);
        Assert.Equal(0f, factory.Input.Value);
    }

    [Fact]
    public void ControlThatThrowsWhileDrivenIsReportedUntilItWorksAgain()
    {
        var (map, services) = Setup();
        map.ControlChannels["drive"] = Control("TrackThrottle", options: new() { ["Bogus"] = 1 });
        var factory = (FakeFactory)services.GetRequiredService<IModuleManagerFactory>();
        var controls = services.GetRequiredService<ControlExecutionService>();
        var health = services.GetRequiredService<ChannelHealthService>();
        controls.Initialize();
        Assert.Equal(ChannelHealthEntry.Warning, Assert.Single(health.Snapshot().Entries).State);

        factory.Input.Throw = true;
        controls.SetControl("drive", 1);
        var entry = Assert.Single(health.Snapshot().Entries);
        Assert.Equal(ChannelHealthEntry.Error, entry.State);
        Assert.Contains("CAN write failed", entry.Message);

        factory.Input.Throw = false;
        controls.SetControl("drive", 1);
        // Back to the option warning of the build.
        entry = Assert.Single(health.Snapshot().Entries);
        Assert.Equal(ChannelHealthEntry.Warning, entry.State);
        Assert.Contains("Bogus", entry.Message);
    }

    [Fact]
    public void FailedBackgroundWriteIsReportedUntilAWriteSucceeds()
    {
        var (map, services) = Setup();
        map.ControlChannels["steer"] = Control("Steering");
        var factory = (FakeFactory)services.GetRequiredService<IModuleManagerFactory>();
        var controls = services.GetRequiredService<ControlExecutionService>();
        var health = services.GetRequiredService<ChannelHealthService>();
        controls.Initialize();

        // The servo write is not awaited by the control; Observe must still see it fail.
        factory.Pwm.Fail = new IOException("i2c nack");
        controls.SetControl("steer", 1);
        var entry = Assert.Single(health.Snapshot().Entries);
        Assert.Equal(ChannelHealthEntry.Error, entry.State);
        Assert.Contains("i2c nack", entry.Message);

        factory.Pwm.Fail = null;
        controls.SetControl("steer", 0);
        Assert.Empty(health.Snapshot().Entries);
    }

    [Fact]
    public void BackgroundErrorOfAReplacedControlIsIgnored()
    {
        var (map, services) = Setup();
        map.ControlChannels["steer"] = Control("Steering");
        var factory = (FakeFactory)services.GetRequiredService<IModuleManagerFactory>();
        var controls = services.GetRequiredService<ControlExecutionService>();
        var health = services.GetRequiredService<ChannelHealthService>();
        controls.Initialize();

        var pending = new TaskCompletionSource();
        factory.Pwm.Next = pending.Task;
        controls.SetControl("steer", 1);
        controls.Reload("steer");
        pending.SetException(new IOException("late"));

        Assert.Empty(health.Snapshot().Entries);
    }

    [Fact]
    public async Task TelemetryReaderErrorsAreReportedAndReloadRetries()
    {
        var (map, services) = Setup();
        map.TelemetryChannels["temp"] = new TelemetryChannelMapItem { TelemetryType = "No.Such.Reader", ServerId = 1 };
        var telemetry = services.GetRequiredService<TelemetryService>();
        var health = services.GetRequiredService<ChannelHealthService>();

        await telemetry.Tick();
        Assert.Contains("No.Such.Reader", Assert.Single(health.Snapshot().Entries).Message);

        map.TelemetryChannels["temp"] = new TelemetryChannelMapItem { TelemetryType = typeof(FlakyReader).AssemblyQualifiedName!, ServerId = 1 };
        telemetry.RequestReload("temp");
        await telemetry.Tick();
        Assert.Empty(health.Snapshot().Entries);

        var state = services.GetRequiredService<FlakyState>();
        state.Throw = true;
        await telemetry.Tick();
        Assert.Contains("sensor gone", Assert.Single(health.Snapshot().Entries).Message);

        state.Throw = false;
        await telemetry.Tick();
        Assert.Empty(health.Snapshot().Entries);
    }

    [Fact]
    public async Task ChangedTelemetryOptionsRebuildTheReader()
    {
        var (map, services) = Setup();
        map.TelemetryChannels["temp"] = new TelemetryChannelMapItem { TelemetryType = typeof(FlakyReader).AssemblyQualifiedName!, ServerId = 1 };
        var telemetry = services.GetRequiredService<TelemetryService>();
        await telemetry.Tick();
        var first = (FlakyReader)telemetry.SourceReaders["temp"];

        map.TelemetryChannels["temp"].Options = new() { ["Offset"] = 5 };
        telemetry.RequestReload("temp");
        await telemetry.Tick();

        var second = (FlakyReader)telemetry.SourceReaders["temp"];
        Assert.NotSame(first, second);
        Assert.True(first.Disposed);
        Assert.Equal(5, second.Offset);
    }

    [Fact]
    public async Task DeletedTelemetryChannelLeavesTheReport()
    {
        var (map, services) = Setup();
        map.TelemetryChannels["temp"] = new TelemetryChannelMapItem { TelemetryType = "No.Such.Reader", ServerId = 1 };
        var telemetry = services.GetRequiredService<TelemetryService>();
        var health = services.GetRequiredService<ChannelHealthService>();
        await telemetry.Tick();
        Assert.Single(health.Snapshot().Entries);

        map.TelemetryChannels.Remove("temp");
        telemetry.RequestReload("temp");
        await telemetry.Tick();
        Assert.Empty(health.Snapshot().Entries);
    }

    // --- helpers ---

    private static ControlChannelMapItem Control(string type, string pinManager = "default", Dictionary<string, object>? options = null) =>
        new() { ControlType = type, PinManager = pinManager, Options = options ?? new() };

    private static (ChannelMap Map, ServiceProvider Services) Setup()
    {
        var map = new ChannelMap();
        var services = new ServiceCollection()
            .AddLogging(b => b.ClearProviders())
            .AddSingleton<IConfiguration>(new ConfigurationBuilder().Build())
            .AddSingleton(map)
            .AddSingleton<IModuleManagerFactory, FakeFactory>()
            .AddSingleton(sp => new ChannelHealthService(null!, sp.GetRequiredService<ILogger<ChannelHealthService>>()))
            .AddSingleton<ControlExecutionService>()
            .AddSingleton<FlakyState>()
            .AddTransient<FlakyReader>()
            .AddTransient<LoggingOnlyControl>()
            .AddTransient<TrackThrottleControl>()
            .AddTransient<SteeringControl>()
            .AddSingleton(sp => new TelemetryService(map, null!, sp.GetRequiredService<IConfiguration>(),
                sp.GetRequiredService<ILogger<TelemetryService>>(), sp, new ServerCarConfigurationService(),
                sp.GetRequiredService<ChannelHealthService>()))
            .BuildServiceProvider();
        return (map, services);
    }

    private sealed class FakeFactory : IModuleManagerFactory, IModuleManager
    {
        public bool Broken { get; set; }
        public FakeInput Input { get; } = new();
        public FakePwm Pwm { get; } = new();
        public IModuleManager Create(string name) => this;

        public T GetModule<T>(int address) where T : class, IModule =>
            Broken ? throw new InvalidOperationException("no bus")
            : typeof(T) == typeof(IPwmModule) ? (T)(object)Pwm : (T)(object)Input;
    }

    /// <summary>Asynchronous like the Raspberry Pi pins: errors only show in the returned task.</summary>
    private sealed class FakePwm : IPwmModule
    {
        public Exception? Fail { get; set; }
        public Task? Next { get; set; }

        public Task SetServoPosition(float position)
        {
            if (Next is { } next) { Next = null; return next; }
            return Fail != null ? Task.FromException(Fail) : Task.CompletedTask;
        }

        public Task SetPwmCyclePercentage(float value) => SetServoPosition(value);
        public Task SetPulseWidthMilliseconds(float pulseWidthMs) => SetServoPosition(pulseWidthMs);
        public Task<float> GetPwmValue() => Task.FromResult(0f);
    }

    private sealed class FakeInput : ITrackDriveInput
    {
        public float Value { get; private set; }
        public bool Released { get; private set; }
        public bool Throw { get; set; }

        public void SetValue(float value)
        {
            if (Throw) throw new IOException("CAN write failed");
            Value = value;
        }

        public void Release()
        {
            Released = true;
            Value = 0;
        }
    }

    public sealed class FlakyState
    {
        public bool Throw { get; set; }
    }

    public sealed class FlakyReader(ILogger<FlakyReader> logger, FlakyState state) : TelemetryReaderBase(logger)
    {
        public int Offset { get; set; }
        public bool Disposed { get; private set; }

        public override Task<string> ReadTelemetry() =>
            state.Throw ? throw new IOException("sensor gone") : Task.FromResult((20 + Offset).ToString());

        protected override void Dispose(bool disposing)
        {
            Disposed = true;
            base.Dispose(disposing);
        }
    }
}
