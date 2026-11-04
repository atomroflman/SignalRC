using SignalRC.Onboard.Control;
using SignalRC.Onboard.Services;
using SignalRC.Shared.Channels;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Hubs;
using SignalRC.Shared.Telemetry;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;
using System.Reflection;
using System.Text.Json;
using TypedSignalR.Client;

namespace SignalRC.Onboard.Telemetry;

public class TelemetryService : IHubConnectionObserver, ITelemetryClient
{
    private readonly HashSet<string> _groupKeyWarnings = new(StringComparer.Ordinal);
    // channel|type pairs whose reader failed to build; EnsureReaders runs every
    // tick and would otherwise retry and log the same failure each time.
    private readonly HashSet<string> _readerFailures = new(StringComparer.Ordinal);
    // Option warnings per channel from the last reader build, restored once a read error clears.
    private readonly Dictionary<string, List<string>> _readerProblems = new(StringComparer.Ordinal);
    // Sources whose last read threw; their channels carry a read error in the health report.
    private readonly HashSet<string> _readFailedSources = new(StringComparer.Ordinal);
    // Channels to rebuild, null for all. Queued from the SignalR thread, taken by the
    // telemetry loop: only Tick touches the reader tables.
    private readonly ConcurrentQueue<string?> _reloadRequests = new();
    private readonly ChannelHealthService? _health;

    private int _tick = 0;
    private IConnectionHubServer? _server;
    private string? _carId;
    private bool _reconnectHandlersAttached;

    // Reader instances, keyed by groupKey (e.g. "battery"). Multiple channels
    // that share a source share a single reader instance and a single tick.
    private readonly Dictionary<string, TelemetryReaderBase> _sourceReaders = new(StringComparer.Ordinal);
    internal IReadOnlyDictionary<string, TelemetryReaderBase> SourceReaders => _sourceReaders;

    // groupKey -> list of channel names that belong to this source.
    private readonly Dictionary<string, List<string>> _sourceChannels = new(StringComparer.Ordinal);

    // What goes to the server (telemetry/README.md §4). Guarded by
    // _trackerLock: SetTelemetryDemand arrives on a SignalR thread, Tick runs
    // on the telemetry loop, the reset on connection events.
    private readonly object _trackerLock = new();
    private readonly TelemetryDeltaTracker _tracker = new(TelemetryDeltaTracker.NewEpoch());

    // Channels without a ServerId cannot be addressed on the wire; logged once.
    private readonly HashSet<string> _channelsWithoutServerId = new(StringComparer.Ordinal);

    public IConfiguration Configuration { get; set; }
    public ILogger<TelemetryService> Logger { get; }
    public ServerConnectionService ServerConnectionService { get; }
    public IServiceProvider ServiceProvider { get; }
    public ChannelMap ChannelMap { get; }
    public ServerCarConfigurationService CarConfigurationService { get; }

public TelemetryService(ChannelMap channelMap, ServerConnectionService serverConnectionService, IConfiguration configuration, ILogger<TelemetryService> logger, IServiceProvider serviceProvider, ServerCarConfigurationService carConfigurationService, ChannelHealthService? health = null)
    {
        _health = health;
        ServiceProvider = serviceProvider;
        ChannelMap = channelMap;
        ServerConnectionService = serverConnectionService;
        Configuration = configuration;
        Logger = logger;
        CarConfigurationService = carConfigurationService;
        CarConfigurationService.OnConfigurationChanged += HandleCarConfigurationChanged;
    }

    public async Task ConnectToServer()
    {
        if (!ServerConnectionService.IsConnected)
        {
            Logger.LogError("Cannot connect telemetry: ServerConnectionService is not connected.");
            return;
        }
        AttachReconnectHandlers(ServerConnectionService.Connection);
        _server = ServerConnectionService.GetProxy();
        _carId = CarConfigurationService.ServerAssignedCarId?.ToString();
        if (string.IsNullOrEmpty(_carId))
        {
            Logger.LogWarning("ServerAssignedCarId not available yet. Telemetry updates will fail until CarId is set.");
            return;
        }
        await _server.RegisterAsOnboard(_carId);
        Logger.LogInformation("Connected to telemetry server with CarId: {CarId}", _carId);
    }

    private void AttachReconnectHandlers(HubConnection connection)
    {
        if (_reconnectHandlersAttached)
        {
            return;
        }
        _reconnectHandlersAttached = true;

        connection.Reconnecting += error =>
        {
            Logger.LogWarning(error, "Telemetry connection reconnecting.");
            // New baseline. Done here rather than in Reconnected: the server
            // sends SetTelemetryDemand right after OpenCarConnection, which may
            // overtake a Reconnected handler and would then be wiped again.
            ResetTelemetryBaseline();
            return Task.CompletedTask;
        };

        connection.Reconnected += async connectionId =>
        {
            Logger.LogInformation("Telemetry connection reconnected ({ConnectionId}).", connectionId);
            await ReregisterOnboardAsync();
        };

        connection.Closed += async error =>
        {
            Logger.LogError(error, "Telemetry connection closed.");
            ResetTelemetryBaseline();
            // Closed is terminal for the SignalR client; the next call will
            // start a fresh HubConnection via ConnectToServer.
            await Task.CompletedTask;
        };
    }

    private async Task ReregisterOnboardAsync()
    {
        if (_server == null)
        {
            return;
        }
        _carId = CarConfigurationService.ServerAssignedCarId?.ToString();
        if (string.IsNullOrEmpty(_carId))
        {
            Logger.LogWarning("Cannot re-register as onboard: ServerAssignedCarId still missing.");
            return;
        }
        try
        {
            await _server.RegisterAsOnboard(_carId);
            Logger.LogInformation("Re-registered as onboard for car {CarId}.", _carId);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to re-register as onboard after reconnect.");
        }
    }

    private void HandleCarConfigurationChanged()
    {
        var newId = CarConfigurationService.ServerAssignedCarId?.ToString();
        if (string.IsNullOrEmpty(newId) || newId == _carId)
        {
            return;
        }

        _carId = newId;
        Logger.LogInformation("ServerAssignedCarId changed to {CarId}. Re-registering as onboard.", _carId);

        if (_server != null && ServerConnectionService.IsConnected)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _server.RegisterAsOnboard(_carId!);
                }
                catch (Exception ex)
                {
                    Logger.LogError(ex, "Failed to register as onboard after CarId change.");
                }
            });
        }
    }

    public Task<IEnumerable<string>> GetAvailableTelemetryChannels()
    {
        return Task.FromResult<IEnumerable<string>>(ChannelMap.TelemetryChannels.Keys.ToList());
    }

    public async Task UpdateTelemetry(string valueName, string value)
    {
        if (!ServerConnectionService.IsConnected)
        {
            Logger.LogError("Cannot send telemetry: Connection is not established.");
            return;
        }
        if (_server == null)
        {
            Logger.LogError("Cannot send telemetry: Server proxy is not set.");
            return;
        }
        if (_carId == null)
        {
            Logger.LogError("Cannot send telemetry: CarId is not set.");
            return;
        }
        await _server.UpdateTelemetry(_carId, valueName, value);
    }

    /// <summary>
    /// Reads every due reader and sends one <see cref="TelemetryDelta"/> for
    /// all of them (D61). Readers are read regardless of demand; sending only
    /// happens once the server has told us what it needs (D59, D68: there is
    /// no fallback to the legacy per-value UpdateTelemetry).
    /// </summary>
    public async Task Tick()
    {
        _tick++;
        if (_tick <= 0)
        {
            _tick = 1;
        }
        EnsureReaders();
        var read = new Dictionary<int, TelemetrySample>();
        foreach (var (sourceKey, reader) in _sourceReaders.ToList())
        {
            var interval = Math.Max(1, reader.ReadIntervalTicks);
            if (_tick % interval != 0)
            {
                continue;
            }

            IReadOnlyDictionary<string, TelemetrySample>? samples;
            try
            {
                samples = await reader.ReadAllSamplesAsync(sourceKey);
            }
            catch (Exception ex)
            {
                // Logged by the health service when the error changes, not every tick.
                if (_health == null)
                    Logger.LogError(ex, "Error reading telemetry from source {Source}", sourceKey);
                _readFailedSources.Add(sourceKey);
                foreach (var channelName in _sourceChannels.GetValueOrDefault(sourceKey) ?? [])
                    _health?.Error(ChannelTypeSchema.Telemetry, channelName, $"Read failed: {ChannelHealthService.Describe(ex)}");
                continue;
            }
            if (_readFailedSources.Remove(sourceKey))
                RestoreBuildHealth(_sourceChannels.GetValueOrDefault(sourceKey) ?? []);
            if (samples == null || samples.Count == 0)
            {
                continue;
            }

            if (!_sourceChannels.TryGetValue(sourceKey, out var channels) || channels.Count == 0)
            {
                continue;
            }

            foreach (var channelName in channels)
            {
                if (!TryResolveValue(channelName, samples, out var sample))
                {
                    continue;
                }
                if (!TryGetServerId(channelName, out var serverId))
                {
                    continue;
                }
                // Every value every tick: Trace, so the default Debug level does not fill the
                // log (2.6 GB on the vehicle). Enable via Logging:LogLevel:SignalRC.Onboard.Telemetry = Trace.
                Logger.LogTrace("Telemetry {Channel}: {Value} ({State}, {AgeMs} ms)", channelName, sample.Value, sample.State, sample.AgeMs);
                read[serverId] = sample;
            }
        }

        await SendDeltaAsync(read);
    }

    private async Task SendDeltaAsync(IReadOnlyDictionary<int, TelemetrySample> read)
    {
        var server = _server;
        if (server == null || !ServerConnectionService.IsConnected)
        {
            return;
        }

        TelemetryDelta? delta;
        lock (_trackerLock)
        {
            delta = _tracker.Tick(read, Environment.TickCount64);
        }
        if (delta == null)
        {
            return;
        }

        try
        {
            await server.UpdateTelemetrySamples(delta);
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Failed to send telemetry delta {Seq}.", delta.Seq);
            // The server may have missed changes; send everything in full again.
            lock (_trackerLock)
            {
                _tracker.ForgetSent();
            }
        }
    }

    private bool TryGetServerId(string channelName, out int serverId)
    {
        if (ChannelMap.TelemetryChannels.TryGetValue(channelName, out var definition) && definition.ServerId is { } id)
        {
            serverId = id;
            return true;
        }
        serverId = 0;
        if (_channelsWithoutServerId.Add(channelName))
        {
            Logger.LogWarning("Telemetry channel {Channel} has no ServerId and cannot be sent.", channelName);
        }
        return false;
    }

    /// <summary>Server → onboard: the channels any client needs right now (D59).</summary>
    public Task SetTelemetryDemand(int[] channelIds)
    {
        lock (_trackerLock)
        {
            _tracker.SetDemand(channelIds ?? []);
        }
        Logger.LogDebug("Telemetry demand set to {Count} channel(s).", channelIds?.Length ?? 0);
        return Task.CompletedTask;
    }

    private void ResetTelemetryBaseline()
    {
        lock (_trackerLock)
        {
            _tracker.Reset();
        }
    }

    /// <summary>Rebuilds the channel's reader on the next tick (and the reader of its source).</summary>
    public void RequestReload(string channelName) => _reloadRequests.Enqueue(channelName);

    /// <summary>Rebuilds every reader on the next tick, e.g. after pin managers were replaced.</summary>
    public void RequestReloadAll() => _reloadRequests.Enqueue(null);

    private void ApplyReloadRequests()
    {
        while (_reloadRequests.TryDequeue(out var channelName))
        {
            var groups = channelName == null
                ? _sourceChannels.Keys.ToList()
                : _sourceChannels.Where(kv => kv.Value.Contains(channelName)).Select(kv => kv.Key).ToList();
            foreach (var groupKey in groups)
            {
                DropSource(groupKey);
            }
            if (channelName == null)
            {
                _readerFailures.Clear();
                continue;
            }
            _readerFailures.RemoveWhere(k => k.StartsWith(channelName + "|", StringComparison.Ordinal));
            _groupKeyWarnings.Remove(channelName);
            _channelsWithoutServerId.Remove(channelName);
            if (!ChannelMap.TelemetryChannels.ContainsKey(channelName))
                ForgetChannel(channelName);
        }
    }

    /// <summary>Disposes the source's reader; its channels get a new one in this EnsureReaders pass.</summary>
    private void DropSource(string groupKey)
    {
        _sourceChannels.Remove(groupKey);
        _readFailedSources.Remove(groupKey);
        if (_sourceReaders.Remove(groupKey, out var dropped))
        {
            try { dropped.Dispose(); }
            catch (Exception ex) { Logger.LogWarning(ex, "Disposing telemetry reader for source {Source} failed.", groupKey); }
        }
    }

    private void ForgetChannel(string channelName)
    {
        _readerProblems.Remove(channelName);
        _health?.Ok(ChannelTypeSchema.Telemetry, channelName);
    }

    private void RestoreBuildHealth(IEnumerable<string> channels)
    {
        foreach (var channelName in channels)
            _health?.Problems(ChannelTypeSchema.Telemetry, channelName, _readerProblems.GetValueOrDefault(channelName) ?? []);
    }

    internal void EnsureReaders()
    {
        ApplyReloadRequests();
        foreach (var (groupKey, channels) in _sourceChannels.ToList())
        {
            var stillPresent = channels.Where(c => ChannelMap.TelemetryChannels.ContainsKey(c)).ToList();
            foreach (var gone in channels.Except(stillPresent))
                ForgetChannel(gone);
            if (stillPresent.Count == 0)
            {
                DropSource(groupKey);
            }
            else if (stillPresent.Count != channels.Count)
            {
                _sourceChannels[groupKey] = stillPresent;
            }
        }

        // Snapshot: the SignalR thread edits the map while this runs on the telemetry loop.
        foreach (var (channelName, definition) in ChannelMap.TelemetryChannels.ToList())
        {
            var groupKey = ResolveGroupKey(channelName, definition);
            if (!_sourceChannels.TryGetValue(groupKey, out var channels))
            {
                channels = new List<string>();
                _sourceChannels[groupKey] = channels;
            }
            if (!channels.Contains(channelName))
            {
                channels.Add(channelName);
            }
            if (!_sourceReaders.ContainsKey(groupKey))
            {
                var reader = CreateReader(channelName, definition);
                if (reader == null)
                {
                    continue;
                }
                _sourceReaders[groupKey] = reader;
                Logger.LogInformation("Created telemetry reader for source {Source} (channel {Channel}).", groupKey, channelName);
            }
        }
    }

    private static bool TryResolveValue<T>(string channelName, IReadOnlyDictionary<string, T> values, out T value)
    {
        if (values.TryGetValue(channelName, out value!))
        {
            return true;
        }
        var dotIndex = channelName.LastIndexOf('.');
        if (dotIndex > 0 && dotIndex < channelName.Length - 1)
        {
            var suffix = channelName[(dotIndex + 1)..];
            if (values.TryGetValue(suffix, out value!))
            {
                return true;
            }
        }
        value = default!;
        return false;
    }

    public Task SubscribeToTelemetryChannel(string channelName)
    {
        // No-op: telemetry is published unconditionally from ChannelMap. Kept
        // for the hub contract — server still calls it on per-user subscribe.
        // UI display preference is tracked separately via UserSetupTelemetry.
        Logger.LogDebug("SubscribeToTelemetryChannel({Channel}) ignored; always-on flow.", channelName);
        return Task.CompletedTask;
    }

    public Task UnsubscribeFromTelemetryChannel(string channelName)
    {
        // No-op: see SubscribeToTelemetryChannel.
        Logger.LogDebug("UnsubscribeFromTelemetryChannel({Channel}) ignored; always-on flow.", channelName);
        return Task.CompletedTask;
    }

    private string ResolveGroupKey(string channelName, TelemetryChannelMapItem definition)
    {
        var key = ChannelOptionBinder.ResolveGroupKey(channelName, definition.Options, out var warning);
        // EnsureReaders runs every tick: warn once per channel.
        if (warning != null && _groupKeyWarnings.Add(channelName))
        {
            Logger.LogWarning("{Warning}", warning);
        }
        return key;
    }

    private TelemetryReaderBase? CreateReader(string channelName, TelemetryChannelMapItem definition)
    {
        var failureKey = channelName + "|" + definition.TelemetryType;
        if (_readerFailures.Contains(failureKey)) return null;

        var resolvedReaderType = Type.GetType(definition.TelemetryType);
        if (resolvedReaderType == null)
        {
            Logger.LogError("Telemetry reader type {Reader} could not be resolved.", definition.TelemetryType);
            _readerFailures.Add(failureKey);
            _health?.Error(ChannelTypeSchema.Telemetry, channelName, $"Telemetry type '{definition.TelemetryType}' not found");
            return null;
        }

        // A reader that cannot be built is one missing telemetry channel, not a
        // reason to take the whole vehicle down: Tick runs on the main loop, and
        // an exception here once ended the process at the first channel whose
        // constructor DI could not satisfy.
        TelemetryReaderBase? reader;
        try
        {
            reader = ServiceProvider.GetRequiredService(resolvedReaderType) as TelemetryReaderBase;
        }
        catch (Exception ex)
        {
            Logger.LogError(ex, "Telemetry reader {Reader} for channel {Channel} could not be created.",
                resolvedReaderType, channelName);
            _readerFailures.Add(failureKey);
            _health?.Error(ChannelTypeSchema.Telemetry, channelName, ex);
            return null;
        }
        if (reader == null)
        {
            Logger.LogError("Telemetry reader type {Reader} is not a TelemetryReaderBase.", resolvedReaderType);
            _readerFailures.Add(failureKey);
            _health?.Error(ChannelTypeSchema.Telemetry, channelName, $"'{definition.TelemetryType}' is not a telemetry reader");
            return null;
        }
        reader.ReadIntervalTicks = Math.Max(1, definition.ReadIntervalTicks);

        var problems = ChannelOptionBinder.Apply(reader, definition.Options, Logger, $"channel {channelName}");
        _readerProblems[channelName] = problems;
        _health?.Problems(ChannelTypeSchema.Telemetry, channelName, problems);

        return reader;
    }

    public Task OnClosed(Exception? exception)
    {
        ResetTelemetryBaseline();
        if (exception == null)
        {
            Logger.LogError("Telemetry connection closed.");
            return Task.CompletedTask;
        }

        Logger.LogError(exception, "Telemetry connection closed unexpectedly.");
        return Task.CompletedTask;
    }

    public Task OnReconnected(string? connectionId)
    {
        if (string.IsNullOrWhiteSpace(connectionId))
        {
            Logger.LogWarning("Telemetry connection reconnected without a connection id.");
            return Task.CompletedTask;
        }
        Logger.LogInformation("Telemetry connection reconnected: {ConnectionId}", connectionId);
        return Task.CompletedTask;
    }

    public Task OnReconnecting(Exception? exception)
    {
        ResetTelemetryBaseline();
        Logger.LogWarning(exception, "Reconnecting telemetry connection.");
        return Task.CompletedTask;
    }
}
