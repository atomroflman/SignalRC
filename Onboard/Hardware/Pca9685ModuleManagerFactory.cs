using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Services;
using SignalRC.Shared.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware
{
    /// <summary>
    /// Factory for creating IModuleManager instances based on ChannelMap configuration.
    /// </summary>
    public class ModuleManagerFactory : IModuleManagerFactory
    {
        private readonly ILoggerFactory _loggerFactory;
        private readonly IServiceProvider _serviceProvider;
        private readonly ChannelMap _channelMap;
        private readonly Dictionary<string, IModuleManager> _instances = new();
        // Pin managers that could not be built: Create would otherwise retry, and log,
        // on every telemetry tick of a reader that resolves it lazily.
        private readonly Dictionary<string, Exception> _failures = new();
        private readonly object _lock = new();

        /// <summary>
        /// Constructor. All dependencies are injected via DI.
        /// </summary>
        public ModuleManagerFactory(ILoggerFactory loggerFactory, IServiceProvider serviceProvider, ChannelMap channelMap)
        {
            _loggerFactory = loggerFactory;
            _serviceProvider = serviceProvider;
            _channelMap = channelMap;
            _instances.Add("default", new RaspberryPiGpioManager(serviceProvider));
        }

        /// <summary>
        /// Creates an IModuleManager instance for the given pin manager name using ChannelMap.
        /// </summary>
        public IModuleManager Create(string name)
        {
            // Controls are rebuilt on the SignalR thread while telemetry readers resolve
            // their pin manager on the telemetry loop.
            lock (_lock)
            {
                if (_instances.TryGetValue(name, out var existing))
                    return existing;
                if (_failures.TryGetValue(name, out var failure))
                    throw new InvalidOperationException($"Pin manager '{name}' failed: {failure.Message}", failure);
                try
                {
                    return Build(name);
                }
                catch (Exception ex)
                {
                    _failures[name] = ex;
                    _serviceProvider.GetService<ChannelHealthService>()?.Error(ChannelTypeSchema.PinManager, name, ex);
                    throw;
                }
            }
        }

        public void Invalidate(string name)
        {
            IModuleManager? dropped;
            lock (_lock)
            {
                _failures.Remove(name);
                if (name == "default" || !_instances.Remove(name, out dropped))
                    return;
            }
            try
            {
                (dropped as IDisposable)?.Dispose();
            }
            catch (Exception ex)
            {
                _loggerFactory.CreateLogger<ModuleManagerFactory>().LogWarning(ex, "Disposing pin manager {Name} failed.", name);
            }
        }

        private IModuleManager Build(string name)
        {
            var logger = _loggerFactory.CreateLogger<ModuleManagerFactory>();
            // Find pin manager config by name
            if (!_channelMap.PinManagers.TryGetValue(name, out var managerConfig))
            {
                logger.LogError($"No pinManager named '{name}' in ChannelMap.");
                return new NullModuleManager(logger);
            }

            var typeName = managerConfig.Type;
            if (string.IsNullOrWhiteSpace(typeName))
                throw new InvalidOperationException($"No type defined for pinManager '{name}'.");

            // Find all types matching the type name (without namespace)
            var matchingTypes = Assembly.GetExecutingAssembly().GetTypes();
            var foundTypes = new List<Type>();
            foreach (var t in matchingTypes)
            {
                if (t.Name.Equals(typeName, StringComparison.OrdinalIgnoreCase))
                    foundTypes.Add(t);
            }
            if (foundTypes.Count == 0)
                throw new NotSupportedException($"Type '{typeName}' not found.");
            if (foundTypes.Count > 1)
            {
                logger
                    .LogWarning($"Multiple types named '{typeName}' found. Using the first: {foundTypes[0].FullName}");
            }
            var type = foundTypes[0];

            // Create instance using DI
            object? instance = null;
            if (type == typeof(Pca9685PwmExtension))
            {
                instance = ActivatorUtilities.CreateInstance(_serviceProvider, type, _serviceProvider);
            }
            else
            {
                instance = ActivatorUtilities.CreateInstance(_serviceProvider, type);
            }

            // Set properties from options dictionary; unknown keys are ignored as before.
            var problems = ChannelOptionBinder.Apply(instance!, managerConfig.Options, logger, $"pinManager {name}", warnUnknown: false);
            var res = instance as IModuleManager ?? throw new InvalidCastException($"{typeName} does not implement IModuleManager");
            _instances.Add(name, res);
            _serviceProvider.GetService<ChannelHealthService>()?.Problems(ChannelTypeSchema.PinManager, name, problems);
            return res;
        }

        private class NullModuleManager : IModuleManager
        {
            public NullModuleManager(ILogger<ModuleManagerFactory> logger)
            {
                Logger = logger;
            }

            public ILogger<ModuleManagerFactory> Logger { get; }

            T IModuleManager.GetModule<T>(int address)
            {
                return new NullModule(Logger) as T;
            }

            private class NullModule : IModule, IPwmModule, IGpioModule
            {
                private ILogger<ModuleManagerFactory> Logger;

                public NullModule(ILogger<ModuleManagerFactory> logger)
                {
                    this.Logger = logger;
                }

                public async Task<float> GetPwmValue()
                {
                    Logger.LogWarning("GetPwmValue on NullModule!");
                    return 0f;
                }

                public async Task<bool> GetValue()
                {
                    Logger.LogWarning("GetValue on NullModule!");
                    return false;
                }

                public async Task SetPulseWidthMilliseconds(float pulseWidthMs)
                {
                    Logger.LogWarning($"SetPulseWidthMilliseconds({pulseWidthMs}) on NullModule!");
                }

                public async Task SetPwmCyclePercentage(float value)
                {
                    Logger.LogWarning($"SetPwmCyclePercentage({value}) on NullModule!");
                }

                public async Task SetServoPosition(float position)
                {
                    Logger.LogWarning($"SetServoPosition({position}) on NullModule!");
                }

                public async Task SetValue(bool value)
                {
                    Logger.LogWarning($"SetValue({value}) on NullModule!");
                }
            }
        }
    }
}
