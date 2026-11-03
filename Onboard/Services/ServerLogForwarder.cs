using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Shared.Logs;

namespace SignalRC.Onboard.Services;

/// <summary>
/// Logger provider that forwards the onboard log to the server, where the GUI shows it
/// (car page → Logs). Entries are buffered while offline, so the startup log and what
/// happened during a connection loss arrive once connected; the buffer is bounded and
/// drops the oldest entries first. Minimum level: LogForwarding:MinLevel (default
/// Information), independent of the console log level.
/// </summary>
public sealed class ServerLogForwarder : ILoggerProvider
{
    private const int Capacity = 5000;
    private const int BatchSize = 500;
    private const int MaxMessageLength = 4000;
    private const int MaxExceptionLength = 8000;
    private static readonly TimeSpan FlushInterval = TimeSpan.FromSeconds(1);

    // Sending a batch logs through SignalR itself; forwarding that would feed the loop.
    private static readonly string[] ExcludedCategories =
    {
        "Microsoft.AspNetCore.SignalR",
        "Microsoft.AspNetCore.Http.Connections",
        typeof(ServerLogForwarder).FullName!,
    };

    private readonly LogLevel _minLevel;
    private readonly ConcurrentQueue<OnboardLogEntry> _queue = new();
    private int _count;
    private long _dropped;
    private ServerConnectionService? _connection;
    private Timer? _timer;
    private int _flushing;
    // A batch the server did not take; resent first so the order stays intact.
    private OnboardLogEntry[]? _pending;
    private bool _sendFailedReported;

    public ServerLogForwarder(LogLevel minLevel)
    {
        _minLevel = minLevel;
    }

    public ILogger CreateLogger(string categoryName) =>
        ExcludedCategories.Any(c => categoryName.StartsWith(c, StringComparison.Ordinal))
            ? NullLogger.Instance
            : new ForwardingLogger(this, categoryName);

    /// <summary>Starts sending; until the connection is up, entries are only buffered.</summary>
    public void Start(ServerConnectionService connection)
    {
        _connection = connection;
        _timer ??= new Timer(_ => _ = FlushAsync(), null, FlushInterval, FlushInterval);
    }

    public void Dispose() => _timer?.Dispose();

    private void Add(OnboardLogEntry entry)
    {
        _queue.Enqueue(entry);
        if (Interlocked.Increment(ref _count) > Capacity && _queue.TryDequeue(out _))
        {
            Interlocked.Decrement(ref _count);
            Interlocked.Increment(ref _dropped);
        }
    }

    private async Task FlushAsync()
    {
        if (Interlocked.Exchange(ref _flushing, 1) == 1) return;
        try
        {
            while (_connection?.IsConnected == true)
            {
                var batch = _pending ?? TakeBatch();
                if (batch.Length == 0) return;
                _pending = batch;
                await _connection.GetProxy().SendOnboardLogs(batch);
                _pending = null;
                _sendFailedReported = false;
            }
        }
        catch (Exception ex)
        {
            // Not through ILogger: that entry would be queued and fail the same way.
            if (!_sendFailedReported)
            {
                _sendFailedReported = true;
                Console.Error.WriteLine($"Forwarding the log to the server failed: {ex.Message}");
            }
        }
        finally
        {
            Volatile.Write(ref _flushing, 0);
        }
    }

    internal OnboardLogEntry[] TakeBatch()
    {
        var batch = new List<OnboardLogEntry>(BatchSize);
        var dropped = Interlocked.Exchange(ref _dropped, 0);
        if (dropped > 0)
        {
            batch.Add(new OnboardLogEntry
            {
                TimestampUtc = DateTime.UtcNow, Level = (int)LogLevel.Warning, Category = typeof(ServerLogForwarder).FullName!,
                Message = $"{dropped} log entries dropped while the server was not reachable.",
            });
        }
        while (batch.Count < BatchSize && _queue.TryDequeue(out var entry))
        {
            Interlocked.Decrement(ref _count);
            batch.Add(entry);
        }
        return batch.ToArray();
    }

    private static string Truncate(string text, int max) => text.Length <= max ? text : text[..max] + " …";

    private sealed class ForwardingLogger(ServerLogForwarder owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None && logLevel >= owner._minLevel;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            owner.Add(new OnboardLogEntry
            {
                TimestampUtc = DateTime.UtcNow,
                Level = (int)logLevel,
                Category = category,
                Message = Truncate(formatter(state, exception), MaxMessageLength),
                Exception = exception == null ? null : Truncate(exception.ToString(), MaxExceptionLength),
            });
        }
    }
}
