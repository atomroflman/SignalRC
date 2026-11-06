using System.Collections.Concurrent;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Input;
using SignalRC.Onboard.Services;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Flow;

namespace SignalRC.Onboard.Flow;

/// <summary>
/// Runs the onboard flow (OnboardFlow-Arbeitspakete.md OF06): holds the pushed definition,
/// ticks the engine at 50 Hz, feeds it handoffs, controllers and local telemetry, writes the
/// owned control channels and reports the status. Session checks are the ControlService's job.
/// </summary>
public sealed class OnboardFlowService : IFlowEnvironment, IDisposable
{
    public const int TickMs = 20;
    /// <summary>A handoff without a new value for this long counts as disconnected (T08).</summary>
    public const int HandoffTimeoutMs = 1500;
    private const int StatusIntervalMs = 200;

    private readonly ILogger<OnboardFlowService> _logger;
    private readonly IControlSink _control;
    private readonly TelemetryService _telemetry;
    private readonly VehicleInputService _inputs;
    private readonly ServerConnectionService _server;
    private readonly FlowEngine _engine = new();
    private readonly object _lock = new();
    private readonly ConcurrentDictionary<int, (double Value, long AtMs)> _handoffs = new();
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private Timer? _timer;
    private volatile bool _webDetached;
    private volatile bool _serverConnected;
    private volatile bool _paused;
    private long _lastStatusMs = long.MinValue;
    private string _lastStatusKey = string.Empty;
    private int _ticking;
    private int _reportingStatus;

    public OnboardFlowService(ILogger<OnboardFlowService> logger, IControlSink control, TelemetryService telemetry, VehicleInputService inputs, ServerConnectionService server)
    {
        _logger = logger;
        _control = control;
        _telemetry = telemetry;
        _inputs = inputs;
        _server = server;
        Clock = () => _clock.ElapsedMilliseconds;
        _inputs.DevicesChanged += () => _ = ReportDevicesAsync();
    }

    /// <summary>Monotonic milliseconds; replaceable for tests.</summary>
    public Func<long> Clock { get; set; }

    public long NowMs => Clock();

    /// <summary>An onboard flow is loaded and runs.</summary>
    public bool IsActive { get { lock (_lock) return _engine.Definition != null; } }

    /// <summary>The web is detached (E13): browser channels and handoffs are ignored.</summary>
    public bool WebDetached => _webDetached;

    /// <summary>True when the onboard flow drives this channel; the browser may not (E03).</summary>
    public bool OwnsChannel(string channel)
    {
        lock (_lock) return _engine.OwnedChannels.Contains(channel);
    }

    /// <summary>Replaces the flow in one step (T06); null switches the onboard flow off.</summary>
    public void Apply(OnboardFlowDefinition? definition)
    {
        IReadOnlyList<string> problems;
        HashSet<string> released;
        lock (_lock)
        {
            var before = _engine.OwnedChannels.ToHashSet(StringComparer.Ordinal);
            if (definition != null && definition.Hash == _engine.Definition?.Hash && _engine.Definition != null)
                return;
            problems = _engine.Load(definition);
            released = before.Where(c => !_engine.OwnedChannels.Contains(c)).ToHashSet(StringComparer.Ordinal);
            if (definition == null)
            {
                _webDetached = false;
                _handoffs.Clear();
            }
        }
        // Channels the flow gave up go to neutral; the browser takes them from here.
        if (released.Count > 0)
            _control.ReleaseControl(released.Contains);
        foreach (var problem in problems)
            _logger.LogWarning("Onboard flow: {Problem}", problem);
        if (definition == null)
        {
            StopTimer();
            _logger.LogInformation("Onboard flow off.");
        }
        else
        {
            _logger.LogInformation("Onboard flow {Hash} of setup {Setup} loaded: {Nodes} nodes, {Links} links, channels {Channels}",
                Short(definition.Hash), definition.SetupId, definition.Nodes.Count, definition.Links.Count, string.Join(", ", _engine.OwnedChannels));
            if (AutoTick) _timer ??= new Timer(_ => TickOnce(), null, 0, TickMs);
        }
        _ = ReportStatusAsync(force: true);
    }

    /// <summary>Session ended or replaced: flow off, attached again, its channels neutral.</summary>
    public void Clear() => Apply(null);

    public void SetHandoff(int nodeId, double value) => _handoffs[nodeId] = (value, NowMs);

    /// <summary>Detaches or reattaches the web. Detaching needs a loaded flow. Returns the new state.</summary>
    public bool SetWebDetached(bool detached)
    {
        lock (_lock)
        {
            if (detached && _engine.Definition == null)
                return false;
            if (_webDetached == detached)
                return detached;
            _webDetached = detached;
            _handoffs.Clear();
        }
        if (detached)
        {
            // Browser channels go neutral (E07); the onboard flow keeps its own.
            _control.ReleaseControl(c => !OwnsChannel(c));
        }
        _logger.LogInformation("Web {State}.", detached ? "detached: onboard flow runs alone" : "attached again");
        _ = ReportStatusAsync(force: true);
        return detached;
    }

    /// <summary>Stops writing (onboard update, T06 lock) without forgetting the flow.</summary>
    public void Pause(bool paused) => _paused = paused;

    public void OnServerConnected()
    {
        _serverConnected = true;
        _ = ReportDevicesAsync();
        _ = ReportStatusAsync(force: true);
    }

    public void OnServerLost()
    {
        _serverConnected = false;
        _handoffs.Clear();
    }

    public (double Value, bool Connected) Handoff(int nodeId)
    {
        if (_webDetached || !_serverConnected) return (0, false);
        if (!_handoffs.TryGetValue(nodeId, out var h) || NowMs - h.AtMs > HandoffTimeoutMs) return (0, false);
        return (h.Value, true);
    }

    public (double Value, bool Connected) VehicleInput(string deviceKey, int code, bool isAxis) => _inputs.Get(deviceKey, code, isAxis);

    public (string Value, bool Valid)? Telemetry(string channelName) => _telemetry.Live.Get(channelName);

    private bool HandoffConnected =>
        !_webDetached && _serverConnected && _handoffs.Values.Any(h => NowMs - h.AtMs <= HandoffTimeoutMs);

    /// <summary>False in tests: ticks only through <see cref="TickOnce"/>.</summary>
    public bool AutoTick { get; set; } = true;

    /// <summary>One evaluation of the flow; called by the 50 Hz timer.</summary>
    public void TickOnce()
    {
        if (Interlocked.Exchange(ref _ticking, 1) == 1) return;
        try
        {
            List<FlowChannelWrite> writes;
            lock (_lock)
            {
                if (_engine.Definition == null) return;
                writes = _engine.Tick(this);
                if (_paused) writes.Clear();
            }
            foreach (var write in writes)
                _control.SetControl(write.Channel, write.Value);
            _ = ReportStatusAsync(force: false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Onboard flow tick failed.");
        }
        finally
        {
            Interlocked.Exchange(ref _ticking, 0);
        }
    }

    public OnboardFlowStatus Status()
    {
        lock (_lock)
        {
            var def = _engine.Definition;
            return new OnboardFlowStatus
            {
                Hash = def?.Hash,
                SetupId = def?.SetupId,
                Mode = def == null ? OnboardFlowMode.Off : _webDetached ? OnboardFlowMode.Detached : OnboardFlowMode.Mixed,
                HandoffConnected = def != null && HandoffConnected,
                Devices = _inputs.States(),
                Values = def == null ? new() : _engine.Values().ToDictionary(kv => kv.Key, kv => Math.Round(kv.Value, 4)),
                OwnedChannels = _engine.OwnedChannels.Order().ToList(),
            };
        }
    }

    private async Task ReportStatusAsync(bool force)
    {
        var now = NowMs;
        if (!force && now - _lastStatusMs < StatusIntervalMs) return;
        if (!_server.IsConnected) return;
        if (Interlocked.Exchange(ref _reportingStatus, 1) == 1 && !force) return;
        try
        {
            var status = Status();
            var key = $"{status.Hash}|{status.Mode}|{status.HandoffConnected}|{string.Join(",", status.Devices.Select(d => d.Key + d.Connected))}|{string.Join(",", status.Values.OrderBy(v => v.Key).Select(v => v.Value))}";
            if (!force && key == _lastStatusKey) return;
            _lastStatusKey = key;
            _lastStatusMs = now;
            await _server.GetProxy().ReportOnboardFlowStatus(status);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Reporting the onboard flow status failed.");
        }
        finally
        {
            Interlocked.Exchange(ref _reportingStatus, 0);
        }
    }

    private async Task ReportDevicesAsync()
    {
        if (!_server.IsConnected) return;
        try
        {
            await _server.GetProxy().ReportVehicleInputDevices(_inputs.KnownDevices());
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Reporting the vehicle controllers failed.");
        }
        await ReportStatusAsync(force: true);
    }

    private void StopTimer()
    {
        _timer?.Dispose();
        _timer = null;
    }

    private static string Short(string hash) => hash.Length > 8 ? hash[..8] : hash;

    public void Dispose() => StopTimer();
}
