using System.Reflection;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Services;

/// <summary>
/// Collects what went wrong with each pin manager, control, telemetry channel and video
/// stream, and sends it to the server for the channel config page. A broken channel is
/// reported here instead of taking the onboard down; only entries that are not OK are
/// kept. Changes are sent debounced, so rebuilding a whole map sends one report.
/// </summary>
public class ChannelHealthService
{
    private static readonly TimeSpan PublishDelay = TimeSpan.FromMilliseconds(300);

    private readonly ServerConnectionService _connection;
    private readonly ILogger<ChannelHealthService> _logger;
    private readonly object _lock = new();
    private readonly Dictionary<(string Kind, string Name), ChannelHealthEntry> _entries = new();
    private readonly Timer _publishTimer;
    private bool _publishFailedLogged;

    public ChannelHealthService(ServerConnectionService connection, ILogger<ChannelHealthService> logger)
    {
        _connection = connection;
        _logger = logger;
        _publishTimer = new Timer(_ => _ = PublishAsync(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Error(string kind, string name, string message) => Set(kind, name, ChannelHealthEntry.Error, message);

    public void Error(string kind, string name, Exception exception) => Error(kind, name, Describe(exception));

    /// <summary>Warns about option problems, or clears the entry when there are none.</summary>
    public void Problems(string kind, string name, IReadOnlyCollection<string> problems)
    {
        if (problems.Count == 0) Ok(kind, name);
        else Set(kind, name, ChannelHealthEntry.Warning, string.Join("; ", problems));
    }

    public void Ok(string kind, string name)
    {
        lock (_lock)
        {
            if (!_entries.Remove((kind, name))) return;
        }
        _logger.LogInformation("{Kind} {Name} is OK again.", kind, name);
        SchedulePublish();
    }

    public bool HasError(string kind, string name)
    {
        lock (_lock)
        {
            return _entries.TryGetValue((kind, name), out var e) && e.State == ChannelHealthEntry.Error;
        }
    }

    public ChannelHealthReport Snapshot()
    {
        lock (_lock)
        {
            return new ChannelHealthReport
            {
                Entries = _entries.Values
                    .Select(e => new ChannelHealthEntry { Kind = e.Kind, Name = e.Name, State = e.State, Message = e.Message, SinceUtc = e.SinceUtc })
                    .OrderBy(e => e.Kind).ThenBy(e => e.Name)
                    .ToArray(),
                GeneratedAtUtc = DateTime.UtcNow,
            };
        }
    }

    /// <summary>Sends the current report now; called after every (re)connect.</summary>
    public async Task PublishAsync()
    {
        // Null in tests, which have no server.
        if (_connection?.IsConnected != true) return;
        try
        {
            await _connection.GetProxy().ReportChannelHealth(Snapshot());
            _publishFailedLogged = false;
        }
        catch (Exception ex)
        {
            // A server without ReportChannelHealth refuses every report; say so once.
            if (!_publishFailedLogged)
            {
                _publishFailedLogged = true;
                _logger.LogWarning(ex, "Failed to send channel health to the server.");
            }
        }
    }

    /// <summary>The message shown in the UI: the real exception, not a DI or reflection wrapper.</summary>
    public static string Describe(Exception exception)
    {
        var ex = exception;
        while (ex is TargetInvocationException or AggregateException && ex.InnerException != null)
            ex = ex.InnerException;
        return $"{ex.GetType().Name}: {ex.Message}";
    }

    private void Set(string kind, string name, string state, string message)
    {
        lock (_lock)
        {
            if (_entries.TryGetValue((kind, name), out var current) && current.State == state && current.Message == message)
                return;
            _entries[(kind, name)] = new ChannelHealthEntry { Kind = kind, Name = name, State = state, Message = message, SinceUtc = DateTime.UtcNow };
        }
        if (state == ChannelHealthEntry.Error)
            _logger.LogError("{Kind} {Name}: {Message}", kind, name, message);
        else
            _logger.LogWarning("{Kind} {Name}: {Message}", kind, name, message);
        SchedulePublish();
    }

    private void SchedulePublish() => _publishTimer.Change(PublishDelay, Timeout.InfiniteTimeSpan);
}
