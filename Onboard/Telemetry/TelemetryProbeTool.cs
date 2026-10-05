using System.Reflection;
using System.Text.Json;
using LteCar.Shared.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Spectre.Console;

namespace LteCar.Onboard.Telemetry;

public class TelemetryProbeTool
{
    private const string GroupKeyOption = "groupKey";

    private readonly ChannelMap _channelMap;
    private readonly IServiceProvider _services;
    private readonly ILogger<TelemetryProbeTool> _logger;

    private readonly Dictionary<string, TelemetryReaderBase> _sourceReaders = new(StringComparer.Ordinal);
    private readonly Dictionary<string, List<string>> _sourceChannels = new(StringComparer.Ordinal);
    private readonly Dictionary<string, string> _channelGroupKey = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string Value, DateTime SeenUtc)> _latest = new(StringComparer.Ordinal);

    private int _tick;

    public TelemetryProbeTool(ChannelMap channelMap, IServiceProvider services, ILogger<TelemetryProbeTool> logger)
    {
        _channelMap = channelMap;
        _services = services;
        _logger = logger;
    }

    public static async Task RunAsync(ConfigLoader configLoader)
    {
        var channelMap = await configLoader.LoadConfigsAsync();
        if (channelMap == null)
        {
            AnsiConsole.MarkupLine("[red]channelMap.json could not be loaded[/]");
            return;
        }

        var services = new ServiceCollection();
        services.AddLogging(c => c
            .AddConsole()
            .SetMinimumLevel(LogLevel.Warning));
        services.AddTransient<Bash>();
        services.AddTransient<ILogger<Bash>>(sp =>
            sp.GetRequiredService<ILoggerFactory>().CreateLogger<Bash>());
        services.AddSingleton<ILogger>(sp =>
            sp.GetRequiredService<ILoggerFactory>().CreateLogger("TelemetryProbe"));

        foreach (var type in DiscoverReaderTypes())
        {
            services.AddTransient(type);
        }

        var sp = services.BuildServiceProvider();
        var logger = sp.GetRequiredService<ILogger<TelemetryProbeTool>>();
        var tool = new TelemetryProbeTool(channelMap, sp, logger);
        await tool.RunAsync();
    }

    private static IEnumerable<Type> DiscoverReaderTypes()
    {
        var readerBase = typeof(TelemetryReaderBase);
        foreach (var assembly in AppDomain.CurrentDomain.GetAssemblies())
        {
            Type[] types;
            try
            {
                types = assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                types = ex.Types.Where(t => t != null).Cast<Type>().ToArray();
            }

            foreach (var type in types)
            {
                if (type != null && readerBase.IsAssignableFrom(type) && type.IsClass && !type.IsAbstract)
                {
                    yield return type;
                }
            }
        }
    }

    private async Task RunAsync()
    {
        AnsiConsole.Clear();
        AnsiConsole.Write(new FigletText("Telemetry Probe").Color(Color.Cyan1));
        AnsiConsole.WriteLine();

        if (_channelMap.TelemetryChannels.Count == 0)
        {
            AnsiConsole.MarkupLine("[yellow]No telemetry channels configured.[/]");
            return;
        }

        SubscribeAll();
        if (_sourceReaders.Count == 0)
        {
            AnsiConsole.MarkupLine("[red]No readers could be created.[/]");
            return;
        }

        AnsiConsole.MarkupLine($"[dim]{_sourceReaders.Count} source(s) covering {_channelMap.TelemetryChannels.Count} channel(s). Press Ctrl+C to quit.[/]");
        AnsiConsole.WriteLine();

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        while (!cts.IsCancellationRequested)
        {
            try
            {
                _tick++;
                await ReadTickAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Tick failed");
            }

            AnsiConsole.Clear();
            AnsiConsole.Write(BuildTable());

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(1), cts.Token);
            }
            catch (TaskCanceledException)
            {
                break;
            }
        }
    }

    private void SubscribeAll()
    {
        foreach (var (channelName, definition) in _channelMap.TelemetryChannels)
        {
            try
            {
                var groupKey = ResolveGroupKey(channelName, definition);
                _channelGroupKey[channelName] = groupKey;

                if (!_sourceChannels.TryGetValue(groupKey, out var channels))
                {
                    channels = new List<string>();
                    _sourceChannels[groupKey] = channels;
                }
                if (!channels.Contains(channelName))
                {
                    channels.Add(channelName);
                }

                if (_sourceReaders.ContainsKey(groupKey))
                {
                    continue;
                }

                var reader = CreateReader(channelName, definition);
                if (reader != null)
                {
                    _sourceReaders[groupKey] = reader;
                    _logger.LogInformation("Created reader {Reader} for groupKey {Group} (channel {Channel})",
                        reader.GetType().Name, groupKey, channelName);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to subscribe channel {Channel}", channelName);
            }
        }
    }

    private async Task ReadTickAsync()
    {
        foreach (var (sourceKey, reader) in _sourceReaders.ToList())
        {
            var interval = Math.Max(1, reader.ReadIntervalTicks);
            if (_tick % interval != 0)
            {
                continue;
            }

            IReadOnlyDictionary<string, string>? values;
            try
            {
                values = await reader.ReadAllTelemetryAsync(sourceKey);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Read error from source {Source}", sourceKey);
                continue;
            }

            if (values == null || values.Count == 0 || !_sourceChannels.TryGetValue(sourceKey, out var channels))
            {
                continue;
            }

            var now = DateTime.UtcNow;
            foreach (var channelName in channels)
            {
                if (!TryResolveValue(channelName, values, out var value))
                {
                    continue;
                }
                _latest[channelName] = (value, now);
            }
        }
    }

    private Table BuildTable()
    {
        var table = new Table().Expand();
        table.Title("[bold cyan]Telemetry Probe[/] [dim](locally read values - nothing is sent anywhere)[/]");
        table.AddColumn("Channel");
        table.AddColumn("Group");
        table.AddColumn("Reader");
        table.AddColumn("Value");
        table.AddColumn("Age");
        table.AddColumn("Last Read (UTC)");

        foreach (var entry in _channelMap.TelemetryChannels.OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var channelName = entry.Key;
            var def = entry.Value;

            _channelGroupKey.TryGetValue(channelName, out var groupKey);
            var readerName = def.TelemetryType?.Split('.').LastOrDefault() ?? "?";

            string valueCell;
            string ageCell;
            string seenCell;
            if (!_latest.TryGetValue(channelName, out var latest) || latest.SeenUtc == default)
            {
                valueCell = "[grey]waiting…[/]";
                ageCell = "—";
                seenCell = "—";
            }
            else
            {
                var age = DateTime.UtcNow - latest.SeenUtc;
                valueCell = string.IsNullOrEmpty(latest.Value) ? "[grey](empty)[/]" : latest.Value;
                ageCell = age.TotalSeconds < 1
                    ? "<1s"
                    : $"[yellow]{(int)age.TotalSeconds}s[/]";
                seenCell = latest.SeenUtc.ToString("HH:mm:ss");
            }

            table.AddRow(channelName, groupKey ?? "?", readerName, valueCell, ageCell, seenCell);
        }

        return table;
    }

    private static string ResolveGroupKey(string channelName, TelemetryChannelMapItem definition)
    {
        if (definition.Options.TryGetValue(GroupKeyOption, out var raw) && raw != null)
        {
            var s = raw.ToString();
            if (!string.IsNullOrWhiteSpace(s))
            {
                return s;
            }
        }
        return channelName;
    }

    private static bool TryResolveValue(string channelName, IReadOnlyDictionary<string, string> values, out string value)
    {
        if (values.TryGetValue(channelName, out value!))
        {
            return true;
        }
        var dot = channelName.LastIndexOf('.');
        if (dot > 0 && dot < channelName.Length - 1)
        {
            var suffix = channelName[(dot + 1)..];
            if (values.TryGetValue(suffix, out value!))
            {
                return true;
            }
        }
        value = string.Empty;
        return false;
    }

    private TelemetryReaderBase? CreateReader(string channelName, TelemetryChannelMapItem definition)
    {
        var resolvedType = Type.GetType(definition.TelemetryType);
        if (resolvedType == null)
        {
            _logger.LogError("Reader type {Type} could not be resolved for channel {Channel}", definition.TelemetryType, channelName);
            return null;
        }

        var reader = _services.GetRequiredService(resolvedType) as TelemetryReaderBase;
        if (reader == null)
        {
            _logger.LogError("Reader type {Type} is not a TelemetryReaderBase", definition.TelemetryType);
            return null;
        }

        reader.ReadIntervalTicks = Math.Max(1, definition.ReadIntervalTicks);

        foreach (var option in definition.Options)
        {
            if (string.Equals(option.Key, GroupKeyOption, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var property = resolvedType.GetProperty(option.Key,
                BindingFlags.IgnoreCase | BindingFlags.Public | BindingFlags.Instance);
            if (property == null || !property.CanWrite)
            {
                _logger.LogWarning("Option {Option} not found or not writable on {Reader} for channel {Channel}",
                    option.Key, resolvedType.Name, channelName);
                continue;
            }

            try
            {
                if (option.Value is null)
                {
                    continue;
                }

                var targetType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                object? converted;
                if (option.Value is JsonElement jsonElement)
                {
                    converted = jsonElement.Deserialize(targetType);
                }
                else if (targetType.IsInstanceOfType(option.Value))
                {
                    converted = option.Value;
                }
                else
                {
                    converted = JsonSerializer.Deserialize(JsonSerializer.Serialize(option.Value), targetType);
                }

                property.SetValue(reader, converted);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set option {Option} for channel {Channel}", option.Key, channelName);
            }
        }

        return reader;
    }
}
