using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Server.Telemetry;

/// <summary>Outgoing side of the relay; the hub implementation sends via SignalR.</summary>
public interface ITelemetryTransport
{
    /// <summary>Tlm(carId, seq, ageMs, changed, touched, touchedAged) to one browser connection.</summary>
    Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged);
    /// <summary>Legacy UpdateTelemetry(name, value) to the old clients of a vehicle.</summary>
    Task SendLegacyAsync(int carId, string channelName, string value);
    Task SendDemandAsync(string onboardConnectionId, int[] channelIds);
}

/// <summary>Telemetry channels of a vehicle (CarTelemetry.Id ↔ ChannelName).</summary>
public interface ITelemetryChannelDirectory
{
    Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId);
}

/// <summary>
/// Server side of the telemetry contract v1.1 (Shared/Overlay/telemetry/README.md §5):
/// caches the last sample per channel, forwards only what each client asked for,
/// tells the onboard the union of all demands and serves old clients and old
/// onboards on the legacy path. All state of a vehicle is guarded by its lock.
/// </summary>
public sealed class TelemetryRelay(
    ITelemetryTransport transport,
    ITelemetryChannelDirectory directory,
    TimeProvider time,
    ILogger<TelemetryRelay> logger,
    ILoggerFactory? loggers = null)
{
    private readonly TelemetryRelayLog _log = new(loggers?.CreateLogger(TelemetryRelayLog.Category) ?? NullLogger.Instance, time);

    private static readonly TimeSpan DemandInterval = TimeSpan.FromMilliseconds(200);
    private static readonly TimeSpan LegacyTouchInterval = TimeSpan.FromMilliseconds(250);

    private sealed class Entry
    {
        public string Value = "";
        public TelemetrySampleState State;
        public int AgeMs;
        public long ReceivedAt;
        public long LastForwardedAt;
    }

    private sealed class Counter
    {
        public long Changes;
        public long Touches;
    }

    private sealed class Car
    {
        public readonly object Lock = new();
        public string? OnboardConnection;
        public string? Epoch;
        public long OnboardSeq = -1;
        public long ClientSeq;
        public readonly Dictionary<int, Entry> Cache = [];
        public IReadOnlyDictionary<int, string> Names = new Dictionary<int, string>();
        public Dictionary<string, int> Ids = [];
        public readonly Dictionary<string, HashSet<int>> Interests = [];
        public readonly HashSet<string> LegacyClients = [];
        public int[] SentDemand = [];
        public long DemandSentAt = long.MinValue;
        public bool DemandScheduled;
        // Diagnostics only (Snapshot); never read by the forwarding.
        public long? LastMessageAt;
        public long AcceptedDeltas;
        public long DroppedOldSeq;
        public readonly Dictionary<int, Counter> Counters = [];
    }

    private readonly Dictionary<int, Car> _cars = [];
    private readonly object _carsLock = new();

    private Car Get(int carId)
    {
        lock (_carsLock)
        {
            if (!_cars.TryGetValue(carId, out var car)) _cars[carId] = car = new Car();
            return car;
        }
    }

    private long Now => time.GetTimestamp() * 1000 / time.TimestampFrequency;

    private async Task RefreshNamesAsync(int carId, Car car)
    {
        var names = await directory.LoadAsync(carId);
        lock (car.Lock)
        {
            car.Names = names;
            car.Ids = names.GroupBy(n => n.Value, StringComparer.Ordinal).ToDictionary(g => g.Key, g => g.First().Key, StringComparer.Ordinal);
        }
    }

    // --- Onboard ---

    /// <summary>The onboard of a vehicle (re)connected: forget its old samples and tell it the current demand.</summary>
    public async Task OnboardConnectedAsync(int carId, string connectionId)
    {
        var car = Get(carId);
        await RefreshNamesAsync(carId, car);
        lock (car.Lock)
        {
            car.OnboardConnection = connectionId;
            car.Epoch = null;
            car.OnboardSeq = -1;
            car.Cache.Clear();
            car.SentDemand = [];
            car.DemandSentAt = long.MinValue;
            car.LastMessageAt = null;
            car.AcceptedDeltas = car.DroppedOldSeq = 0;
            car.Counters.Clear();
        }
        await UpdateDemandAsync(carId, car, force: true);
    }

    public void OnboardDisconnected(int carId, string connectionId)
    {
        var car = Get(carId);
        lock (car.Lock)
        {
            if (car.OnboardConnection != connectionId) return;
            car.OnboardConnection = null;
            car.Cache.Clear();
            car.Epoch = null;
        }
    }

    /// <summary>A delta from the onboard registered for <paramref name="carId"/>.</summary>
    public async Task OnDeltaAsync(int carId, TelemetryDelta delta)
    {
        var car = Get(carId);
        var now = Now;
        var changed = new List<(int Id, Entry Entry)>();
        bool unknownId;
        lock (car.Lock)
        {
            car.LastMessageAt = now;
            if (delta.Epoch != car.Epoch)
            {
                // A new onboard process: its samples replace everything cached.
                _log.NewEpoch(carId, car.Epoch, delta.Epoch);
                car.Epoch = delta.Epoch;
                car.OnboardSeq = -1;
                car.Cache.Clear();
            }
            if (delta.Seq <= car.OnboardSeq)
            {
                car.DroppedOldSeq++;
                _log.DroppedOldSeq(carId, delta, car.OnboardSeq, car.Names);
                return;
            }
            car.OnboardSeq = delta.Seq;
            car.AcceptedDeltas++;
            foreach (var c in delta.Changed)
            {
                var entry = new Entry { Value = c.Value, State = c.State, AgeMs = c.AgeMs ?? delta.AgeMs, ReceivedAt = now, LastForwardedAt = now };
                car.Cache[c.Id] = entry;
                changed.Add((c.Id, entry));
                Count(car, c.Id).Changes++;
            }
            foreach (var id in delta.Touched) Touch(car, id, delta.AgeMs, now);
            for (var i = 0; i + 1 < delta.TouchedAged.Length; i += 2) Touch(car, delta.TouchedAged[i], delta.TouchedAged[i + 1], now);
            unknownId = changed.Any(c => !car.Names.ContainsKey(c.Id));
            _log.Delta(carId, delta, car.Names);
        }
        if (unknownId) await RefreshNamesAsync(carId, car);
        await ForwardAsync(carId, car, delta.AgeMs, changed, delta.Touched, delta.TouchedAged);
        await ForwardLegacyAsync(carId, car, changed);
    }

    private static void Touch(Car car, int id, int ageMs, long now)
    {
        if (!car.Cache.TryGetValue(id, out var entry)) return;
        entry.AgeMs = ageMs;
        entry.ReceivedAt = now;
        Count(car, id).Touches++;
    }

    private static Counter Count(Car car, int id)
    {
        if (!car.Counters.TryGetValue(id, out var counter)) car.Counters[id] = counter = new Counter();
        return counter;
    }

    /// <summary>A delta from a connection that is not a registered onboard (D56); only counted for the log.</summary>
    public void RejectedDelta(string? claimedCarId) => _log.Rejected(int.TryParse(claimedCarId, out var id) ? id : 0);

    /// <summary>
    /// A value on the legacy path (old onboard). It has no quality, so it is
    /// Unchecked with age 0, and goes through the same change/confirm logic.
    /// </summary>
    public async Task OnLegacyValueAsync(int carId, string channelName, string value)
    {
        var car = Get(carId);
        int id;
        lock (car.Lock) id = car.Ids.GetValueOrDefault(channelName, -1);
        if (id < 0)
        {
            await RefreshNamesAsync(carId, car);
            lock (car.Lock) id = car.Ids.GetValueOrDefault(channelName, -1);
            if (id < 0) return;
        }
        var now = Now;
        var changed = new List<(int, Entry)>();
        var touched = Array.Empty<int>();
        lock (car.Lock)
        {
            car.LastMessageAt = now;
            _log.LegacyValue(carId, car.Names);
            if (car.Cache.TryGetValue(id, out var entry) && entry.Value == value && entry.State == TelemetrySampleState.Unchecked)
            {
                Count(car, id).Touches++;
                entry.AgeMs = 0;
                entry.ReceivedAt = now;
                if (now - entry.LastForwardedAt < LegacyTouchInterval.TotalMilliseconds) return;
                entry.LastForwardedAt = now;
                touched = [id];
            }
            else
            {
                entry = new Entry { Value = value, State = TelemetrySampleState.Unchecked, ReceivedAt = now, LastForwardedAt = now };
                car.Cache[id] = entry;
                changed.Add((id, entry));
                Count(car, id).Changes++;
            }
        }
        await ForwardAsync(carId, car, 0, changed, touched, []);
        await ForwardLegacyAsync(carId, car, changed);
    }

    // --- Browser clients ---

    /// <summary>
    /// Replaces the channels a connection wants for a vehicle. Newly added
    /// channels are answered at once from the cache, with their current age.
    /// </summary>
    public async Task SetInterestAsync(string connectionId, int carId, IEnumerable<int> channelIds)
    {
        var car = Get(carId);
        var ids = channelIds.ToHashSet();
        var now = Now;
        object[][] snapshot;
        long seq;
        lock (car.Lock)
        {
            var previous = car.Interests.GetValueOrDefault(connectionId) ?? [];
            if (ids.Count == 0) car.Interests.Remove(connectionId);
            else car.Interests[connectionId] = ids;
            snapshot = ids.Where(id => !previous.Contains(id) && car.Cache.ContainsKey(id)).Order()
                .Select(id => Change(id, car.Cache[id], (int)Math.Min(int.MaxValue, car.Cache[id].AgeMs + (now - car.Cache[id].ReceivedAt)), -1))
                .ToArray();
            seq = ++car.ClientSeq;
        }
        if (snapshot.Length > 0) await transport.SendSamplesAsync(connectionId, carId, seq, 0, snapshot, [], []);
        await UpdateDemandAsync(carId, car);
    }

    public async Task AddLegacyClientAsync(string connectionId, int carId)
    {
        var car = Get(carId);
        lock (car.Lock) car.LegacyClients.Add(connectionId);
        await UpdateDemandAsync(carId, car);
    }

    public async Task RemoveLegacyClientAsync(string connectionId, int carId)
    {
        var car = Get(carId);
        lock (car.Lock) car.LegacyClients.Remove(connectionId);
        await UpdateDemandAsync(carId, car);
    }

    /// <summary>Forgets a disconnected connection everywhere; an onboard connection also drops its cache.</summary>
    public async Task ConnectionClosedAsync(string connectionId)
    {
        List<(int, Car)> affected;
        lock (_carsLock) affected = _cars.Select(kv => (kv.Key, kv.Value)).ToList();
        foreach (var (carId, car) in affected)
        {
            bool changed;
            lock (car.Lock)
            {
                changed = car.Interests.Remove(connectionId) | car.LegacyClients.Remove(connectionId);
            }
            OnboardDisconnected(carId, connectionId);
            if (changed) await UpdateDemandAsync(carId, car);
        }
    }

    // --- Forwarding ---

    private static object[] Change(int id, Entry e, int ageMs, int defaultAge)
    {
        if (ageMs != defaultAge) return [id, e.Value, (int)e.State, ageMs];
        return e.State == TelemetrySampleState.Valid ? [id, e.Value] : [id, e.Value, (int)e.State];
    }

    private async Task ForwardAsync(int carId, Car car, int defaultAge, List<(int Id, Entry Entry)> changed, int[] touched, int[] touchedAged)
    {
        var sends = new List<(string Connection, long Seq, object[][] Changed, int[] Touched, int[] TouchedAged)>();
        lock (car.Lock)
        {
            foreach (var (connection, ids) in car.Interests)
            {
                var c = changed.Where(x => ids.Contains(x.Id)).Select(x => Change(x.Id, x.Entry, x.Entry.AgeMs, defaultAge)).ToArray();
                var t = touched.Where(ids.Contains).ToArray();
                var ta = new List<int>();
                for (var i = 0; i + 1 < touchedAged.Length; i += 2)
                {
                    if (ids.Contains(touchedAged[i])) ta.AddRange([touchedAged[i], touchedAged[i + 1]]);
                }
                if (c.Length == 0 && t.Length == 0 && ta.Count == 0) continue;
                sends.Add((connection, ++car.ClientSeq, c, t, ta.ToArray()));
            }
        }
        foreach (var s in sends)
        {
            await transport.SendSamplesAsync(s.Connection, carId, s.Seq, defaultAge, s.Changed, s.Touched, s.TouchedAged);
        }
    }

    /// <summary>Old clients get changed values only, the way they always got them; NoData is not sent.</summary>
    private async Task ForwardLegacyAsync(int carId, Car car, List<(int Id, Entry Entry)> changed)
    {
        List<(string Name, string Value)> legacy;
        lock (car.Lock)
        {
            if (car.LegacyClients.Count == 0) return;
            legacy = changed.Where(c => c.Entry.State != TelemetrySampleState.NoData && car.Names.ContainsKey(c.Id))
                .Select(c => (car.Names[c.Id], c.Entry.Value)).ToList();
        }
        foreach (var (name, value) in legacy) await transport.SendLegacyAsync(carId, name, value);
    }

    // --- Diagnostics ---

    /// <summary>
    /// Read-only state of a vehicle for the diagnostics endpoint: cache, demand
    /// and interest counts. Connection ids are not part of it.
    /// </summary>
    public TelemetryRelaySnapshot Snapshot(int carId)
    {
        Car? car;
        lock (_carsLock) _cars.TryGetValue(carId, out car);
        if (car == null) return new TelemetryRelaySnapshot(false, null, -1, null, 0, 0, [], null, 0, 0, []);
        var now = Now;
        lock (car.Lock)
        {
            var interested = new Dictionary<int, int>();
            foreach (var ids in car.Interests.Values)
            {
                foreach (var id in ids) interested[id] = interested.GetValueOrDefault(id) + 1;
            }
            var channelIds = car.Cache.Keys.Concat(interested.Keys).Concat(car.SentDemand).Concat(car.Counters.Keys).Distinct().Order();
            var channels = channelIds.Select(id =>
            {
                car.Cache.TryGetValue(id, out var e);
                car.Counters.TryGetValue(id, out var c);
                return new TelemetryRelayChannelSnapshot(
                    id,
                    car.Names.GetValueOrDefault(id),
                    e?.Value,
                    e?.State,
                    e == null ? null : (int)Math.Min(int.MaxValue, e.AgeMs + (now - e.ReceivedAt)),
                    e == null ? null : now - e.ReceivedAt,
                    car.SentDemand.Contains(id),
                    interested.GetValueOrDefault(id),
                    c?.Changes ?? 0,
                    c?.Touches ?? 0);
            }).ToList();
            return new TelemetryRelaySnapshot(
                car.OnboardConnection != null,
                car.Epoch,
                car.OnboardSeq,
                car.LastMessageAt == null ? null : now - car.LastMessageAt.Value,
                car.AcceptedDeltas,
                car.DroppedOldSeq,
                [.. car.SentDemand],
                car.DemandSentAt == long.MinValue ? null : now - car.DemandSentAt,
                car.Interests.Count,
                car.LegacyClients.Count,
                channels);
        }
    }

    // --- Demand (D59) ---

    /// <summary>
    /// Sends the union of all interests to the onboard, at most every 200 ms;
    /// changes in between are coalesced into one later send.
    /// </summary>
    private async Task UpdateDemandAsync(int carId, Car car, bool force = false)
    {
        string? onboard;
        int[] demand;
        int[] previous = [];
        TimeSpan wait;
        lock (car.Lock)
        {
            onboard = car.OnboardConnection;
            if (onboard == null) return;
            demand = car.LegacyClients.Count > 0
                ? car.Names.Keys.Order().ToArray()
                : car.Interests.Values.SelectMany(i => i).Distinct().Order().ToArray();
            if (!force && demand.SequenceEqual(car.SentDemand)) return;
            var elapsed = Now - car.DemandSentAt;
            wait = force ? TimeSpan.Zero : TimeSpan.FromMilliseconds(Math.Max(0, DemandInterval.TotalMilliseconds - elapsed));
            if (wait > TimeSpan.Zero)
            {
                if (car.DemandScheduled) return;
                car.DemandScheduled = true;
            }
            else
            {
                previous = car.SentDemand;
                car.SentDemand = demand;
                car.DemandSentAt = Now;
            }
        }
        if (wait > TimeSpan.Zero)
        {
            _ = Task.Run(async () =>
            {
                await Task.Delay(wait, time);
                lock (car.Lock) car.DemandScheduled = false;
                await UpdateDemandAsync(carId, car);
            });
            return;
        }
        if (force || !demand.SequenceEqual(previous)) _log.Demand(carId, previous, demand);
        try
        {
            await transport.SendDemandAsync(onboard, demand);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Sending telemetry demand to car {CarId} failed", carId);
        }
    }
}

public sealed record TelemetryRelayChannelSnapshot(
    int Id,
    string? Name,
    string? Value,
    TelemetrySampleState? State,
    int? AgeMs,
    long? ReceivedAgoMs,
    bool InDemand,
    int Interested,
    long Changes,
    long Touches);

public sealed record TelemetryRelaySnapshot(
    bool OnboardConnected,
    string? Epoch,
    long Seq,
    long? LastMessageAgoMs,
    long AcceptedDeltas,
    long DroppedOldSeq,
    int[] Demand,
    long? DemandSentAgoMs,
    int InterestedConnections,
    int LegacyClients,
    IReadOnlyList<TelemetryRelayChannelSnapshot> Channels);
