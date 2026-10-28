using System.Reflection;
using System.Text.Json;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Hardware;
using SignalRC.Shared.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control;

public class ControlExecutionService
{
    public IServiceProvider ServiceProvider { get; }
    public ILogger<ControlExecutionService> Logger { get; }
    public bool RunInTestMode { get; }

    private readonly Dictionary<string, IControlType> _controls = new();
    private readonly ChannelMap _channelMap;

    public ControlExecutionService(ChannelMap channelMap, IServiceProvider serviceProvider, ILogger<ControlExecutionService> logger)
    {
        _channelMap = channelMap;
        ServiceProvider = serviceProvider;
        Logger = logger;
        RunInTestMode = serviceProvider.GetRequiredService<IConfiguration>().GetValue<bool>("RunInTestMode");
    }
    
    public void Initialize()
    {
        if (RunInTestMode)
        {
            Logger.LogWarning("Running in test mode. Skipping control initialization.");
            return;
        }
        foreach (var channel in _channelMap.ControlChannels)
        {
            InitializeChannel(channel.Key, channel.Value);
        }
    }

    private void InitializeChannel(string name, ControlChannelMapItem item)
    {
        var controlType = GetControlType(item.ControlType);
        if (controlType == null)
            return;
        Logger.LogDebug($"Got type {controlType.Name} for channel {name}.");
        var baseControl = ServiceProvider.GetService(controlType) as ControlTypeBase;
        if (baseControl == null)
            throw new Exception($"ControlType '{item.ControlType}' can not be instantiated");

        var pinManagerName = item.PinManager;
        if (string.IsNullOrWhiteSpace(pinManagerName))
            pinManagerName = "default";
        var pinManager = ServiceProvider.GetRequiredService<IModuleManagerFactory>().Create(pinManagerName);
        if (pinManager == null)
            throw new Exception($"Pin manager '{pinManagerName}' not found in ChannelMap.");
        baseControl.PinManager = pinManager;
        baseControl.Name = name;
        baseControl.Options = item.Options;
        baseControl.TestDisabled = item.TestDisabled;
        baseControl.Address = item.Address;
        IControlType control = baseControl;
        if (item.MaxResendInterval is { } resendMs)
        {
            control = new ResendRequiredContolDecorator(baseControl, TimeSpan.FromMilliseconds(resendMs), TimeSpan.FromMilliseconds(resendMs) / 3);
        }
        control.Initialize();
        _controls.Add(name, control);
        Logger.LogInformation($"Initialized Channel: {name} - {item.ControlType}@{pinManagerName}:{item.Address}");
    }

    public async Task RunControlTestsAsync() 
    {
        if (RunInTestMode)
        {
            Logger.LogWarning("Running in test mode. Skipping control tests.");
            return;
        }
        foreach (var c in _controls) {
            if (c.Value.TestDisabled)
            {
                Logger.LogInformation($"Skipping test for {c.Key} as it is disabled.");
                continue;
            }
            Logger.LogInformation($"Testing: {c.Key}");
            await c.Value.RunTestAsync();
        }
    }
    
    public void SetControl(string channel, decimal value)
    {
        if (RunInTestMode)
        {
            Logger.LogInformation($"Set control {channel} to {value} in test mode.");
            return;
        }
        if (!_controls.ContainsKey(channel))
        {
            // Added in the UI after startup (e.g. a new sound channel): set it up on first use.
            if (!_channelMap.ControlChannels.TryGetValue(channel, out var item))
            {
                Logger.LogError($"Channel not configured: {channel}");
                return;
            }
            try
            {
                InitializeChannel(channel, item);
            }
            catch (Exception ex)
            {
                Logger.LogError(ex, $"Channel {channel} could not be initialized.");
                return;
            }
        }
        var control = _controls[channel];
        Logger.LogDebug($"New Channel Value: {channel}: {value} => PIN: {control}");
        control.OnControlRecived(value);
    }

    public void ReleaseControl()
    {
        if (RunInTestMode)
        {
            Logger.LogInformation($"Release Control in test mode.");
            return;
        }
        foreach (var control in _controls)
        {
            control.Value.OnControlReleased();
        }
    }

    private Type? GetControlType(string valueControlType)
    {
        var t = typeof(ControlTypeBase).Assembly.GetTypes()
            .FirstOrDefault(type => (type.GetCustomAttributes(typeof(ControlTypeAttribute), false).FirstOrDefault() as ControlTypeAttribute)?.TypeName == valueControlType);
        if (t == null)
        {
            Logger.LogError($"ControlType {valueControlType} not found! Just logging inputs.");
            return typeof(LoggingOnlyControl);
        }
        return t;
    }
}

