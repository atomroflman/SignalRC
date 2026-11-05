using System.Globalization;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using SignalRC.Server.Data;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Server.Telemetry.History;

/// <summary>
/// Stores the recorded telemetry channels of every vehicle (telemetry history).
/// A session runs from the onboard connecting until it disconnects; a reconnect
/// within <see cref="ReconnectGap"/> continues it. Samples are limited by
/// <see cref="TelemetryThrottle"/> and written in batches; all session changes
/// and inserts run on one writer loop so they keep their order.
/// </summary>
public sealed class TelemetryRecorder(IServiceScopeFactory scopes, TimeProvider time, ILogger<TelemetryRecorder> logger)
    : BackgroundService, ITelemetrySink
{
    public static readonly TimeSpan ReconnectGap = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan WriteInterval = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan FlushInterval = TimeSpan.FromMilliseconds(100);
    private static readonly TimeSpan RetentionInterval = TimeSpan.FromHours(1);
    private const int MaxQueued = 500_000;
    private const int MaxBatch = 20_000;

    internal static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private abstract record Op(int CarId);
    private sealed record OpenOp(int CarId, DateTime At, List<TelemetrySessionChannel> Channels) : Op(CarId);
    private sealed record ChannelsOp(int CarId, List<TelemetrySessionChannel> Channels) : Op(CarId);
    private sealed record CloseOp(int CarId, DateTime At) : Op(CarId);
    private sealed record SampleOp(int CarId, int ChannelId, long Time, double Value) : Op(CarId);

    private sealed class CarState
    {
        public readonly object Lock = new();
        public bool Connected;
        public bool Recording;
        public Dictionary<int, TelemetryDataType> Types = [];
        public TelemetryThrottle Throttle = new();
    }

    private readonly Dictionary<int, CarState> _cars = [];
    private readonly Channel<Op> _queue = Channel.CreateBounded<Op>(new BoundedChannelOptions(MaxQueued)
    {
        FullMode = BoundedChannelFullMode.DropWrite,
        SingleReader = true,
    });
    private long _dropped;

    // Owned by the writer loop: the open session of each vehicle.
    private readonly Dictionary<int, int> _openSessions = [];

    private CarState Get(int carId)
    {
        lock (_cars)
        {
            if (!_cars.TryGetValue(carId, out var car)) _cars[carId] = car = new CarState();
            return car;
        }
    }

    private DateTime UtcNow => time.GetUtcNow().UtcDateTime;

    // --- ITelemetrySink ---

    public async Task<IReadOnlyCollection<int>> OnboardConnectedAsync(int carId)
    {
        var channels = await LoadRecordedChannelsAsync(carId);
        var car = Get(carId);
        lock (car.Lock)
        {
            car.Connected = true;
            Apply(carId, car, channels, reopen: true);
        }
        return channels.Select(c => c.Id).ToArray();
    }

    public void OnboardDisconnected(int carId)
    {
        var car = Get(carId);
        lock (car.Lock)
        {
            car.Connected = false;
            if (!car.Recording) return;
            FlushPending(carId, car, long.MaxValue);
            car.Recording = false;
            Enqueue(new CloseOp(carId, UtcNow));
        }
    }

    public void OnSamples(int carId, DateTime receivedUtc, IReadOnlyList<RecordedSample> samples)
    {
        var car = Get(carId);
        var received = new DateTimeOffset(receivedUtc, TimeSpan.Zero).ToUnixTimeMilliseconds();
        lock (car.Lock)
        {
            if (!car.Recording) return;
            var rows = new List<(long Time, double Value)>(2);
            foreach (var s in samples)
            {
                if (!car.Types.TryGetValue(s.Id, out var type)) continue;
                rows.Clear();
                car.Throttle.Offer(s.Id, received - s.AgeMs, Parse(s.Value, s.State, type), s.Touched, rows);
                foreach (var (t, v) in rows) Enqueue(new SampleOp(carId, s.Id, t, v));
            }
        }
    }

    /// <summary>
    /// The history settings of a vehicle changed: reloads its recorded channels,
    /// starts or ends the running session accordingly and returns the channel ids.
    /// </summary>
    public async Task<IReadOnlyCollection<int>> RefreshAsync(int carId)
    {
        var channels = await LoadRecordedChannelsAsync(carId);
        var car = Get(carId);
        lock (car.Lock)
        {
            if (car.Connected) Apply(carId, car, channels, reopen: false);
        }
        return channels.Select(c => c.Id).ToArray();
    }

    /// <summary>Under car.Lock.</summary>
    private void Apply(int carId, CarState car, List<TelemetrySessionChannel> channels, bool reopen)
    {
        car.Types = channels.ToDictionary(c => c.Id, c => c.DataType);
        if (channels.Count == 0)
        {
            if (car.Recording)
            {
                FlushPending(carId, car, long.MaxValue);
                Enqueue(new CloseOp(carId, UtcNow));
            }
            car.Recording = false;
            return;
        }
        if (car.Recording && !reopen)
        {
            Enqueue(new ChannelsOp(carId, channels));
            return;
        }
        car.Throttle = new TelemetryThrottle();
        car.Recording = true;
        Enqueue(new OpenOp(carId, UtcNow, channels));
    }

    private void FlushPending(int carId, CarState car, long now)
    {
        foreach (var (id, t, v) in car.Throttle.Flush(now)) Enqueue(new SampleOp(carId, id, t, v));
    }

    private void Enqueue(Op op)
    {
        if (_queue.Writer.TryWrite(op)) return;
        if (Interlocked.Increment(ref _dropped) % 10_000 == 1)
        {
            logger.LogWarning("Telemetry history queue full, dropping samples ({Dropped} so far)", _dropped);
        }
    }

    public static double Parse(string text, TelemetrySampleState state, TelemetryDataType type)
    {
        if (state is not (TelemetrySampleState.Valid or TelemetrySampleState.Unchecked)) return double.NaN;
        var t = text.Trim();
        if (type == TelemetryDataType.Boolean)
        {
            if (t == "1" || t.Equals("true", StringComparison.OrdinalIgnoreCase)) return 1;
            if (t == "0" || t.Equals("false", StringComparison.OrdinalIgnoreCase)) return 0;
            return double.NaN;
        }
        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && double.IsFinite(v) ? v : double.NaN;
    }

    public static bool IsRecordable(TelemetryDataType type) =>
        type is TelemetryDataType.Integer or TelemetryDataType.Number or TelemetryDataType.Boolean;

    private async Task<List<TelemetrySessionChannel>> LoadRecordedChannelsAsync(int carId)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        // Stopped by the driver: no channels, so the running session ends and nothing is demanded.
        if (await db.Cars.AnyAsync(c => c.Id == carId && c.TelemetryRecordingStopped)) return [];
        var rows = await db.CarTelemetry.AsNoTracking()
            .Where(t => t.CarId == carId && t.Record)
            .Select(t => new { t.Id, t.ChannelName, t.DataType, t.Unit, t.Decimals })
            .ToListAsync();
        return rows.Where(r => IsRecordable(r.DataType))
            .Select(r => new TelemetrySessionChannel(r.Id, r.ChannelName, r.DataType, r.Unit, r.Decimals))
            .ToList();
    }

    // --- Background loops ---

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await CloseDanglingSessionsAsync(stoppingToken);
        }
        catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogWarning(ex, "Telemetry history: closing sessions left open failed");
        }
        await Task.WhenAll(FlushLoopAsync(stoppingToken), WriteLoopAsync(stoppingToken), RetentionLoopAsync(stoppingToken));
    }

    /// <summary>Writes the last value of a burst once its interval has passed.</summary>
    private async Task FlushLoopAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(FlushInterval, time);
        try
        {
            while (await timer.WaitForNextTickAsync(ct))
            {
                var now = time.GetUtcNow().ToUnixTimeMilliseconds();
                List<(int, CarState)> cars;
                lock (_cars) cars = _cars.Select(kv => (kv.Key, kv.Value)).ToList();
                foreach (var (carId, car) in cars)
                {
                    lock (car.Lock)
                    {
                        if (car.Recording) FlushPending(carId, car, now);
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    private async Task WriteLoopAsync(CancellationToken ct)
    {
        var batch = new List<Op>();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(WriteInterval, time, ct);
            }
            catch (OperationCanceledException)
            {
                // Write what is left before the server stops.
            }
            batch.Clear();
            while (batch.Count < MaxBatch && _queue.Reader.TryRead(out var op)) batch.Add(op);
            if (batch.Count == 0) continue;
            try
            {
                await WriteAsync(batch);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Telemetry history: writing {Count} operations failed", batch.Count);
            }
        }
    }

    private async Task WriteAsync(List<Op> batch)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        var rows = new List<(int SessionId, SampleOp Sample)>();
        foreach (var op in batch)
        {
            switch (op)
            {
                case SampleOp s:
                    if (_openSessions.TryGetValue(s.CarId, out var sessionId)) rows.Add((sessionId, s));
                    break;
                case OpenOp o:
                    await InsertAsync(db, rows);
                    _openSessions[o.CarId] = await OpenSessionAsync(db, o);
                    break;
                case ChannelsOp c:
                    if (_openSessions.TryGetValue(c.CarId, out var open)) await MergeChannelsAsync(db, open, c.Channels);
                    break;
                case CloseOp c:
                    await InsertAsync(db, rows);
                    if (_openSessions.Remove(c.CarId, out var closing)) await CloseSessionAsync(db, closing, c.At);
                    break;
            }
        }
        await InsertAsync(db, rows);
    }

    private async Task<int> OpenSessionAsync(SignalRCContext db, OpenOp op)
    {
        db.ChangeTracker.Clear();
        var last = await db.TelemetrySessions
            .Where(s => s.CarId == op.CarId)
            .OrderByDescending(s => s.StartedAt)
            .FirstOrDefaultAsync();
        if (last != null && (last.EndedAt == null || last.EndedAt >= op.At - ReconnectGap))
        {
            last.EndedAt = null;
            last.ChannelsJson = Merge(last.ChannelsJson, op.Channels);
            await db.SaveChangesAsync();
            logger.LogInformation("Telemetry history: car {CarId} continues session {SessionId}", op.CarId, last.Id);
            return last.Id;
        }
        var session = new TelemetrySession
        {
            CarId = op.CarId,
            StartedAt = op.At,
            ChannelsJson = Merge("[]", op.Channels),
        };
        db.TelemetrySessions.Add(session);
        await db.SaveChangesAsync();
        logger.LogInformation("Telemetry history: car {CarId} started session {SessionId} with {Count} channels", op.CarId, session.Id, op.Channels.Count);
        return session.Id;
    }

    private static async Task MergeChannelsAsync(SignalRCContext db, int sessionId, List<TelemetrySessionChannel> channels)
    {
        db.ChangeTracker.Clear();
        var session = await db.TelemetrySessions.FindAsync(sessionId);
        if (session == null) return;
        session.ChannelsJson = Merge(session.ChannelsJson, channels);
        await db.SaveChangesAsync();
    }

    /// <summary>Channels of the session plus the current ones; the current metadata wins.</summary>
    public static string Merge(string json, IEnumerable<TelemetrySessionChannel> channels)
    {
        var byId = ReadChannels(json).ToDictionary(c => c.Id);
        foreach (var c in channels) byId[c.Id] = c;
        return JsonSerializer.Serialize(byId.Values.OrderBy(c => c.Name, StringComparer.Ordinal).ToList(), Json);
    }

    public static List<TelemetrySessionChannel> ReadChannels(string json)
    {
        try { return JsonSerializer.Deserialize<List<TelemetrySessionChannel>>(json, Json) ?? []; }
        catch (JsonException) { return []; }
    }

    // Set-based on purpose: a tracked session of this context would still show
    // the LastSampleAt from before the inserts of this batch.
    private static async Task CloseSessionAsync(SignalRCContext db, int sessionId, DateTime at)
    {
        // Nothing was recorded: no empty entries in the session list.
        var deleted = await db.TelemetrySessions.Where(s => s.Id == sessionId && s.LastSampleAt == null).ExecuteDeleteAsync();
        if (deleted == 0)
        {
            await db.TelemetrySessions.Where(s => s.Id == sessionId).ExecuteUpdateAsync(u => u.SetProperty(s => s.EndedAt, at));
        }
    }

    private static async Task InsertAsync(SignalRCContext db, List<(int SessionId, SampleOp Sample)> rows)
    {
        if (rows.Count == 0) return;
        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open) await connection.OpenAsync();
        await using (var writer = await connection.BeginBinaryImportAsync(
            "COPY \"TelemetrySamples\" (\"SessionId\", \"ChannelId\", \"Time\", \"Value\") FROM STDIN (FORMAT BINARY)"))
        {
            foreach (var (sessionId, s) in rows)
            {
                await writer.StartRowAsync();
                await writer.WriteAsync(sessionId, NpgsqlDbType.Integer);
                await writer.WriteAsync(s.ChannelId, NpgsqlDbType.Integer);
                await writer.WriteAsync(DateTimeOffset.FromUnixTimeMilliseconds(s.Time).UtcDateTime, NpgsqlDbType.TimestampTz);
                await writer.WriteAsync(s.Value, NpgsqlDbType.Double);
            }
            await writer.CompleteAsync();
        }
        foreach (var group in rows.GroupBy(r => r.SessionId))
        {
            var newest = DateTimeOffset.FromUnixTimeMilliseconds(group.Max(r => r.Sample.Time)).UtcDateTime;
            await db.TelemetrySessions
                .Where(s => s.Id == group.Key && (s.LastSampleAt == null || s.LastSampleAt < newest))
                .ExecuteUpdateAsync(u => u.SetProperty(s => s.LastSampleAt, newest));
        }
        rows.Clear();
    }

    /// <summary>After a server restart no onboard is connected: sessions still open end at their last sample.</summary>
    private async Task CloseDanglingSessionsAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        await db.TelemetrySessions.Where(s => s.EndedAt == null && s.LastSampleAt == null).ExecuteDeleteAsync(ct);
        await db.TelemetrySessions.Where(s => s.EndedAt == null)
            .ExecuteUpdateAsync(u => u.SetProperty(s => s.EndedAt, s => s.LastSampleAt), ct);
    }

    private async Task RetentionLoopAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(1), time, ct);
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    await ApplyRetentionAsync(ct);
                }
                catch (Exception ex) when (!ct.IsCancellationRequested)
                {
                    logger.LogWarning(ex, "Telemetry history: retention cleanup failed");
                }
                await Task.Delay(RetentionInterval, time, ct);
            }
        }
        catch (OperationCanceledException) { }
    }

    /// <summary>Deletes samples older than the retention of their vehicle and sessions that ended before it.</summary>
    public async Task ApplyRetentionAsync(CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        var cars = await db.Cars.AsNoTracking().Select(c => new { c.Id, c.TelemetryRetentionDays }).ToListAsync(ct);
        foreach (var car in cars)
        {
            var cutoff = UtcNow.AddDays(-Math.Max(1, car.TelemetryRetentionDays));
            var samples = await db.TelemetrySamples
                .Where(s => s.Session.CarId == car.Id && s.Time < cutoff)
                .ExecuteDeleteAsync(ct);
            var sessions = await db.TelemetrySessions
                .Where(s => s.CarId == car.Id && s.EndedAt != null && s.EndedAt < cutoff)
                .ExecuteDeleteAsync(ct);
            if (samples > 0 || sessions > 0)
            {
                logger.LogInformation("Telemetry history: removed {Sessions} sessions and {Samples} samples of car {CarId}", sessions, samples, car.Id);
            }
        }
    }
}
