using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using LteCar.Shared.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Hardware
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
            var logger = _loggerFactory.CreateLogger<ModuleManagerFactory>();
            if (_instances.ContainsKey(name))
            {
                // Return existing instance if already created
                return _instances[name];
            }
            // Find pin manager config by name
            if (!_channelMap.PinManagers.TryGetValue(name, out var managerConfig))
            {
                logger.LogError($"No pinManager named '{name}' in ChannelMap.");
                return new NullModuleManager(logger);
            }

            var typeName = managerConfig.Type;
            if (string.IsNullOrWhiteSpace(typeName))
            {
                logger.LogError($"No type defined for pinManager '{name}'.");
                return new NullModuleManager(logger);
            }

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

            // Set properties from options dictionary
            foreach (var kv in managerConfig.Options)
            {
                var pi = type.GetProperty(kv.Key, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
                if (pi != null && pi.CanWrite)
                {
                    if (kv.Value is JsonElement jsonElement && jsonElement.ValueKind == System.Text.Json.JsonValueKind.Null)
                        continue; // Skip null values
                    if (kv.Value is JsonElement jsonValue)
                    {
                        // Handle JsonElement conversion
                        if (jsonValue.ValueKind == System.Text.Json.JsonValueKind.String)
                        {
                            pi.SetValue(instance, jsonValue.GetString());
                        }
                        else if (jsonValue.ValueKind == System.Text.Json.JsonValueKind.Number)
                        {
                            if (pi.PropertyType == typeof(int))
                                pi.SetValue(instance, jsonValue.GetInt32());
                            else if (pi.PropertyType == typeof(float))
                                pi.SetValue(instance, jsonValue.GetSingle());
                            else if (pi.PropertyType == typeof(double))
                                pi.SetValue(instance, jsonValue.GetDouble());
                            else if (pi.PropertyType == typeof(long))
                                pi.SetValue(instance, jsonValue.GetInt64());
                        }
                        else if (jsonValue.ValueKind == System.Text.Json.JsonValueKind.True || jsonValue.ValueKind == System.Text.Json.JsonValueKind.False)
                        {
                            if (pi.PropertyType == typeof(bool))
                                pi.SetValue(instance, jsonValue.GetBoolean());
                        }
                        else if (jsonValue.ValueKind == System.Text.Json.JsonValueKind.Object || jsonValue.ValueKind == System.Text.Json.JsonValueKind.Array)
                        {
                            // Handle complex types (e.g. dictionaries, lists)
                            var optionsJson = jsonValue.GetRawText();
                            var optionsType = pi.PropertyType;
                            if (optionsType.IsGenericType && optionsType.GetGenericTypeDefinition() == typeof(Dictionary<,>))
                            {
                                var genericArgs = optionsType.GetGenericArguments();
                                if (genericArgs.Length == 2 && genericArgs[0] == typeof(string))
                                {
                                    // Deserialize to Dictionary<string, object>        
                                    var dictType = typeof(Dictionary<,>).MakeGenericType(genericArgs);
                                    var dict = JsonSerializer.Deserialize(optionsJson, dictType);
                                    pi.SetValue(instance, dict);
                                }
                            }
                            else if (optionsType.IsArray)
                            {
                                // Deserialize to array
                                var elementType = optionsType.GetElementType();
                                if (elementType != null)
                                {
                                    var array = JsonSerializer.Deserialize(optionsJson, optionsType);
                                    pi.SetValue(instance, array);
                                }
                            }
                        }
                    }
                    else
                    {
                        if (kv.Value is not IConvertible)
                            continue;
                        // Handle primitive types directly
                        if (pi.PropertyType == typeof(string))
                            pi.SetValue(instance, kv.Value.ToString());
                        else if (pi.PropertyType == typeof(int))
                            pi.SetValue(instance, Convert.ToInt32(kv.Value));
                        else if (pi.PropertyType == typeof(float))
                            pi.SetValue(instance, Convert.ToSingle(kv.Value));
                        else if (pi.PropertyType == typeof(double))
                            pi.SetValue(instance, Convert.ToDouble(kv.Value));
                        else if (pi.PropertyType == typeof(bool))
                            pi.SetValue(instance, Convert.ToBoolean(kv.Value));
                    }
                }
            }
            var res = instance as IModuleManager ?? throw new InvalidCastException($"{typeName} does not implement IModuleManager");
            _instances.Add(name, res);
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
