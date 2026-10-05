using System.Reflection;
using System.Text.Json;
using LteCar.Onboard.Control.ControlTypes;
using LteCar.Onboard.Hardware;
using LteCar.Shared.Channels;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Control;

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
            var controlType = GetControlType(channel.Value.ControlType);
            if (controlType == null)
                continue;
            Logger.LogDebug($"Got type {controlType.Name} for channel {channel.Key}.");
            var control = ServiceProvider.GetService(controlType) as IControlType;
            if (control == null)
                throw new Exception($"ControlType '{channel.Value.ControlType}' can not be instantiated");
            
            var pinManagerName = channel.Value.PinManager;
            if (string.IsNullOrWhiteSpace(pinManagerName))
                pinManagerName = "default";
            var pinManager = ServiceProvider.GetRequiredService<IModuleManagerFactory>().Create(pinManagerName);
            if (pinManager == null)
                throw new Exception($"Pin manager '{pinManagerName}' not found in ChannelMap.");
            baseControl.PinManager = pinManager;
            baseControl.Name = channel.Key;
            baseControl.Options = channel.Value.Options;
            baseControl.TestDisabled = channel.Value.TestDisabled;
            baseControl.Address = channel.Value.Address;
            IControlType control = baseControl;
            if (channel.Value.MaxResendInterval is { } resendMs)
            {
                control = new ResendRequiredContolDecorator(control, TimeSpan.FromMilliseconds((double)channel.Value.MaxResendInterval!.Value), TimeSpan.FromMilliseconds((double)channel.Value.MaxResendInterval!.Value) / 3);
            }
            control.Initialize();
            _controls.Add(channel.Key, control);
            Logger.LogInformation($"Initialized Channel: {channel.Key} - {channel.Value.ControlType}@{pinManagerName}:{channel.Value.Address}");
        }
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
            Logger.LogError($"Channel not configured: {channel}");
            return;
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

