using System.Reflection;
using System.Text.Json;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Services;
using SignalRC.Shared.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control;

/// <summary>
/// Builds one control per control channel and feeds it the driver's values. A channel
/// that cannot be built or throws while driven is reported to <see cref="ChannelHealthService"/>
/// and left out; it never takes the other channels or the onboard down. Channels are
/// rebuilt when the server pushes a changed config (<see cref="Reload"/>, <see cref="ReloadAll"/>).
/// </summary>
public class ControlExecutionService
{
    public IServiceProvider ServiceProvider { get; }
    public ILogger<ControlExecutionService> Logger { get; }
    public bool RunInTestMode { get; }

    private sealed record ControlEntry(IControlType Control, ControlTypeBase Inner);

    // Rebuilds arrive on the SignalR thread, values on the SignalR thread and the
    // resend decorator's timer: everything that touches _controls holds _lock.
    private readonly object _lock = new();
    private readonly Dictionary<string, ControlEntry> _controls = new();
    // Option warnings from the last build, restored once a runtime error clears.
    private readonly Dictionary<string, List<string>> _buildProblems = new();
    private readonly HashSet<string> _runtimeFailed = new();
    private readonly ChannelMap _channelMap;
    private readonly ChannelHealthService _health;
    private bool _initialized;

    public ControlExecutionService(ChannelMap channelMap, IServiceProvider serviceProvider, ILogger<ControlExecutionService> logger, ChannelHealthService health)
    {
        _channelMap = channelMap;
        ServiceProvider = serviceProvider;
        Logger = logger;
        _health = health;
        RunInTestMode = serviceProvider.GetRequiredService<IConfiguration>().GetValue<bool>("RunInTestMode");
    }

    public void Initialize()
    {
        if (RunInTestMode)
        {
            Logger.LogWarning("Running in test mode. Skipping control initialization.");
            return;
        }
        lock (_lock)
        {
            _initialized = true;
            foreach (var name in _channelMap.ControlChannels.Keys.ToList())
                Build(name);
        }
    }

    /// <summary>Rebuilds one channel from the ChannelMap, or removes it when it is gone.</summary>
    public void Reload(string name)
    {
        lock (_lock)
        {
            if (!_initialized) return;
            Remove(name);
            if (_channelMap.ControlChannels.ContainsKey(name))
                Build(name);
            else
                _health.Ok(ChannelTypeSchema.Control, name);
        }
    }

    /// <summary>
    /// Rebuilds every channel, after pin managers changed or a full map arrived.
    /// <paramref name="beforeBuild"/> runs once all old controls are released, so pin
    /// managers can be replaced while nothing uses them.
    /// </summary>
    public void ReloadAll(Action? beforeBuild = null)
    {
        lock (_lock)
        {
            if (!_initialized)
            {
                beforeBuild?.Invoke();
                return;
            }
            foreach (var name in _controls.Keys.ToList())
            {
                Remove(name);
                if (!_channelMap.ControlChannels.ContainsKey(name))
                    _health.Ok(ChannelTypeSchema.Control, name);
            }
            beforeBuild?.Invoke();
            foreach (var name in _channelMap.ControlChannels.Keys.ToList())
                Build(name);
        }
    }

    private void Build(string name)
    {
        var channel = _channelMap.ControlChannels[name];
        var problems = new List<string>();
        _runtimeFailed.Remove(name);
        _buildProblems.Remove(name);
        ControlTypeBase? baseControl = null;
        try
        {
            var controlType = GetControlType(channel.ControlType);
            if (controlType == null)
            {
                problems.Add($"ControlType '{channel.ControlType}' not found, inputs are only logged");
                controlType = typeof(LoggingOnlyControl);
            }
            Logger.LogDebug($"Got type {controlType.Name} for channel {name}.");
            baseControl = ServiceProvider.GetService(controlType) as ControlTypeBase;
            if (baseControl == null)
                throw new Exception($"ControlType '{channel.ControlType}' can not be instantiated");

            var pinManagerName = channel.PinManager;
            if (string.IsNullOrWhiteSpace(pinManagerName))
                pinManagerName = "default";
            if (pinManagerName != "default" && !_channelMap.PinManagers.ContainsKey(pinManagerName))
                throw new Exception($"Pin manager '{pinManagerName}' not found in ChannelMap.");
            baseControl.PinManager = ServiceProvider.GetRequiredService<IModuleManagerFactory>().Create(pinManagerName);
            baseControl.Name = name;
            baseControl.Options = channel.Options;
            problems.AddRange(ChannelOptionBinder.Apply(baseControl, channel.Options, Logger, $"channel {name}"));
            baseControl.TestDisabled = channel.TestDisabled;
            baseControl.Address = channel.Address;
            IControlType control = baseControl;
            if (channel.MaxResendInterval is { } resendMs)
            {
                control = new ResendRequiredContolDecorator(baseControl, TimeSpan.FromMilliseconds(resendMs), TimeSpan.FromMilliseconds(resendMs) / 3);
            }
            control.Initialize();
            _controls.Add(name, new ControlEntry(control, baseControl));
            _buildProblems[name] = problems;
            _health.Problems(ChannelTypeSchema.Control, name, problems);
            Logger.LogInformation($"Initialized Channel: {name} - {channel.ControlType}@{pinManagerName}:{channel.Address}");
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Control channel {Channel} could not be initialized.", name);
            (baseControl as IDisposable)?.Dispose();
            _health.Error(ChannelTypeSchema.Control, name, ex);
        }
    }

    /// <summary>Releases (neutral position) and disposes the channel's control, if built.</summary>
    private void Remove(string name)
    {
        if (!_controls.Remove(name, out var entry)) return;
        try
        {
            entry.Control.OnControlReleased();
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Releasing control channel {Channel} failed.", name);
        }
        try
        {
            (entry.Control as IDisposable)?.Dispose();
            if (!ReferenceEquals(entry.Control, entry.Inner))
                (entry.Inner as IDisposable)?.Dispose();
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Disposing control channel {Channel} failed.", name);
        }
        Logger.LogInformation("Removed control channel {Channel}.", name);
    }

    public async Task RunControlTestsAsync()
    {
        if (RunInTestMode)
        {
            Logger.LogWarning("Running in test mode. Skipping control tests.");
            return;
        }
        List<KeyValuePair<string, ControlEntry>> controls;
        lock (_lock)
        {
            controls = _controls.ToList();
        }
        foreach (var c in controls) {
            if (c.Value.Control.TestDisabled)
            {
                Logger.LogInformation($"Skipping test for {c.Key} as it is disabled.");
                continue;
            }
            Logger.LogInformation($"Testing: {c.Key}");
            try
            {
                await c.Value.Control.RunTestAsync();
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, "Test of control channel {Channel} failed.", c.Key);
                _health.Error(ChannelTypeSchema.Control, c.Key, $"Test failed: {ChannelHealthService.Describe(ex)}");
            }
        }
    }

    public void SetControl(string channel, decimal value)
    {
        if (RunInTestMode)
        {
            Logger.LogInformation($"Set control {channel} to {value} in test mode.");
            return;
        }
        lock (_lock)
        {
            if (!_controls.TryGetValue(channel, out var entry))
            {
                // A channel that failed to build is already in the health report;
                // don't log it again at the driver's update rate.
                if (!_health.HasError(ChannelTypeSchema.Control, channel))
                    Logger.LogError($"Channel not configured: {channel}");
                return;
            }
            var control = entry.Control;
            Logger.LogDebug($"New Channel Value: {channel}: {value} => PIN: {control}");
            try
            {
                control.OnControlRecived(value);
                if (_runtimeFailed.Remove(channel))
                    _health.Problems(ChannelTypeSchema.Control, channel, _buildProblems.GetValueOrDefault(channel) ?? []);
            }
            catch (Exception ex)
            {
                _runtimeFailed.Add(channel);
                _health.Error(ChannelTypeSchema.Control, channel, ex);
            }
        }
    }

    public void ReleaseControl()
    {
        if (RunInTestMode)
        {
            Logger.LogInformation($"Release Control in test mode.");
            return;
        }
        lock (_lock)
        {
            foreach (var control in _controls)
            {
                try
                {
                    control.Value.Control.OnControlReleased();
                }
                catch (Exception ex)
                {
                    Logger.LogError(ex, "Releasing control channel {Channel} failed.", control.Key);
                    _health.Error(ChannelTypeSchema.Control, control.Key, $"Release failed: {ChannelHealthService.Describe(ex)}");
                }
            }
        }
    }

    private Type? GetControlType(string valueControlType)
    {
        var t = typeof(ControlTypeBase).Assembly.GetTypes()
            .FirstOrDefault(type => (type.GetCustomAttributes(typeof(ControlTypeAttribute), false).FirstOrDefault() as ControlTypeAttribute)?.TypeName == valueControlType);
        if (t == null)
            Logger.LogError($"ControlType {valueControlType} not found! Just logging inputs.");
        return t;
    }
}
