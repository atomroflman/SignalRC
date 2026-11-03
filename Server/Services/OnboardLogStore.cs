using SignalRC.Shared.Logs;

namespace SignalRC.Server.Services;

// ponytail: in-memory ring buffer of the forwarded onboard log per car. Kept across
// disconnects (what happened before the car dropped off is the interesting part),
// lost on server restart. The GUI polls with the last seq it has.
public class OnboardLogStore
{
    public const int Capacity = 5000;

    private readonly Dictionary<int, CarLog> _logs = new();
    private readonly object _lock = new();

    public void Add(int carId, IEnumerable<OnboardLogEntry> entries)
    {
        lock (_lock)
        {
            if (!_logs.TryGetValue(carId, out var log))
                _logs[carId] = log = new CarLog();
            foreach (var entry in entries)
            {
                entry.Seq = ++log.LastSeq;
                log.Entries.Enqueue(entry);
                if (log.Entries.Count > Capacity) log.Entries.Dequeue();
            }
        }
    }

    /// <summary>Entries after <paramref name="afterSeq"/>, oldest first, at most the newest <paramref name="limit"/>.</summary>
    public (OnboardLogEntry[] Entries, long LastSeq) Get(int carId, long afterSeq, int limit)
    {
        lock (_lock)
        {
            if (!_logs.TryGetValue(carId, out var log)) return (Array.Empty<OnboardLogEntry>(), 0);
            var newer = log.Entries.Where(e => e.Seq > afterSeq).ToList();
            return (newer.Skip(Math.Max(0, newer.Count - limit)).ToArray(), log.LastSeq);
        }
    }

    public void Clear(int carId)
    {
        lock (_lock)
        {
            if (_logs.TryGetValue(carId, out var log)) log.Entries.Clear();
        }
    }

    private sealed class CarLog
    {
        public readonly Queue<OnboardLogEntry> Entries = new();
        public long LastSeq;
    }
}
