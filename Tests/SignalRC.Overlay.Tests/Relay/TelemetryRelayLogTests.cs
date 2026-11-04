using Microsoft.Extensions.Logging;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Relay;

/// <summary>Rate-limited relay diagnostics (telemetry/README.md §5 "Diagnose").</summary>
public class TelemetryRelayLogTests
{
    private const int Car = 3;
    private readonly ManualTime _time = new();
    private readonly CapturingLoggers _loggers = new();
    private readonly TelemetryRelay _relay;

    public TelemetryRelayLogTests()
    {
        _relay = new TelemetryRelay(new NullTransport(), new Names(), _time, _loggers.CreateLogger<TelemetryRelay>(), _loggers);
    }

    private static TelemetryDelta Delta(long seq, string epoch = "e1", params (int Id, string Value)[] changed) => new()
    {
        Epoch = epoch, Seq = seq, AgeMs = 10,
        Changed = changed.Select(c => new TelemetryChange { Id = c.Id, Value = c.Value }).ToList(),
        Touched = [2],
    };

    private List<CapturingLoggers.Entry> Diagnostics(LogLevel level, string contains) =>
        _loggers.Entries.Where(e => e.Category == TelemetryRelayLog.Category && e.Level == level && e.Message.Contains(contains)).ToList();

    [Fact]
    public async Task SummarizesAtMostEveryFiveSecondsPerVehicle()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        for (var seq = 0; seq < 20; seq++)
        {
            await _relay.OnDeltaAsync(Car, Delta(seq, changed: (1, "x" + seq)));
            _time.Advance(TimeSpan.FromMilliseconds(400));
        }
        // t = 0 (first delta) and t = 5.2 s; 20 deltas over 8 s.
        var summaries = Diagnostics(LogLevel.Information, "deltas in");
        Assert.Equal(2, summaries.Count);
        Assert.Contains("1 deltas in 0 ms", summaries[0].Message);
        Assert.Contains("13 deltas in 5200 ms (changed 13, touched 13", summaries[1].Message);
        Assert.Contains("epoch e1 seq 13", summaries[1].Message);

        // Details of the same windows on Debug, with channel names and value lengths.
        var details = Diagnostics(LogLevel.Debug, "changed channels");
        Assert.Equal(2, details.Count);
        Assert.Contains("1:speed len 3", details[1].Message);

        // Another vehicle has its own window.
        await _relay.OnDeltaAsync(Car + 1, Delta(0, changed: (1, "y")));
        Assert.Equal(3, Diagnostics(LogLevel.Information, "deltas in").Count);
    }

    [Fact]
    public async Task CountsDroppedAndRejectedDeltasAndLogsDemandChanges()
    {
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.OnDeltaAsync(Car, Delta(5, changed: (9, new string('a', 1200))));
        await _relay.OnDeltaAsync(Car, Delta(5));
        await _relay.OnDeltaAsync(Car, Delta(4));
        _relay.RejectedDelta(Car.ToString());
        _time.Advance(TelemetryRelayLog.Interval);
        await _relay.OnDeltaAsync(Car, Delta(6));
        var last = Diagnostics(LogLevel.Information, "deltas in")[^1].Message;
        Assert.Contains("dropped 2 with old seq, rejected 1 of foreign origin", last);
        Assert.Contains("longest value 1200 chars", Diagnostics(LogLevel.Information, "deltas in")[0].Message);

        await _relay.OnDeltaAsync(Car, Delta(0, epoch: "e2"));
        Assert.Single(Diagnostics(LogLevel.Information, "new onboard epoch e2"));

        Assert.Single(Diagnostics(LogLevel.Information, "demand to onboard []"));
        await _relay.SetInterestAsync("viewer", Car, [2, 1]);
        Assert.Single(Diagnostics(LogLevel.Information, "demand to onboard [1, 2]"));
        // Unchanged demand is not logged again.
        await _relay.SetInterestAsync("viewer2", Car, [1]);
        Assert.Equal(2, Diagnostics(LogLevel.Information, "demand to onboard").Count);
    }

    [Fact]
    public async Task IsSilentWhenTheCategoryIsOff()
    {
        _loggers.MinLevel = LogLevel.Warning;
        await _relay.OnboardConnectedAsync(Car, "onboard");
        await _relay.OnDeltaAsync(Car, Delta(0, changed: (1, "x")));
        await _relay.OnDeltaAsync(Car, Delta(0));
        Assert.Empty(_loggers.Entries);
    }

    private sealed class ManualTime : TimeProvider
    {
        private long _ticks = 1_000_000;
        public void Advance(TimeSpan by) => Interlocked.Add(ref _ticks, by.Ticks);
        public override long GetTimestamp() => Interlocked.Read(ref _ticks);
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    }

    private sealed class Names : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [1] = "speed", [2] = "volt", [9] = "lidarGrid" });
    }

    private sealed class NullTransport : ITelemetryTransport
    {
        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) => Task.CompletedTask;
        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }
}

/// <summary>Logger factory that keeps every entry, with a minimum level like the log configuration.</summary>
public sealed class CapturingLoggers : ILoggerFactory
{
    public sealed record Entry(string Category, LogLevel Level, string Message);

    public LogLevel MinLevel = LogLevel.Trace;
    private readonly List<Entry> _entries = [];

    public List<Entry> Entries
    {
        get { lock (_entries) return [.. _entries]; }
    }

    public ILogger CreateLogger(string categoryName) => new Logger(this, categoryName);
    public ILogger<T> CreateLogger<T>() => new Logger<T>(this);
    public void AddProvider(ILoggerProvider provider) { }
    public void Dispose() { }

    private sealed class Logger(CapturingLoggers owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => logLevel >= owner.MinLevel;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            lock (owner._entries) owner._entries.Add(new Entry(category, logLevel, formatter(state, exception)));
        }
    }
}
