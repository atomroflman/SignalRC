using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Decides what of one onboard tick goes to the server (telemetry/README.md §4,
/// D59–D61; reference cases in Shared/Overlay/fixtures/telemetry/cases.json).
///
/// Pure and clock-free: the caller passes the samples read this tick, keyed by
/// server channel id, and a monotonic "now" in milliseconds.
/// <list type="bullet">
/// <item>Nothing is produced until <see cref="SetDemand"/> was called after
/// construction or <see cref="Reset"/>; undemanded channels never go out.</item>
/// <item>A value goes out in full on its first read, when it is newly demanded,
/// and when value or state changed. Otherwise it is confirmed by id, at most
/// every <see cref="ConfirmIntervalMs"/>.</item>
/// <item><see cref="Reset"/> (reconnect) forgets what was sent and the demand.
/// Epoch and seq are kept: seq stays strictly increasing for the whole process.</item>
/// </list>
/// Not thread-safe; the caller serializes <see cref="SetDemand"/>,
/// <see cref="Reset"/> and <see cref="Tick"/>.
/// </summary>
public sealed class TelemetryDeltaTracker
{
    public const int ConfirmIntervalMs = 250;

    private readonly Dictionary<int, Sent> _sent = new();
    private HashSet<int> _demand = new();
    private long _seq;

    private readonly record struct Sent(string Value, TelemetrySampleState State, long AtMs);

    public TelemetryDeltaTracker(string epoch)
    {
        Epoch = epoch;
    }

    public string Epoch { get; }

    /// <summary>True once a demand was set since construction or the last reset.</summary>
    public bool HasDemand { get; private set; }

    /// <summary>Seq of the last produced delta (0 before the first).</summary>
    public long LastSeq => _seq;

    /// <summary>Replaces the demand; takes effect with the next <see cref="Tick"/>.</summary>
    public void SetDemand(IEnumerable<int> channelIds)
    {
        _demand = new HashSet<int>(channelIds);
        HasDemand = true;
        // Forgetting what was sent for channels that are no longer demanded
        // makes them go out in full when they are demanded again.
        foreach (var id in _sent.Keys.Where(id => !_demand.Contains(id)).ToList())
        {
            _sent.Remove(id);
        }
    }

    /// <summary>New baseline after a (re)connect: no demand, nothing sent yet.</summary>
    public void Reset()
    {
        _sent.Clear();
        _demand = new HashSet<int>();
        HasDemand = false;
    }

    /// <summary>Keeps the demand but sends every value in full again (e.g. after a failed send).</summary>
    public void ForgetSent() => _sent.Clear();

    /// <summary>Random, short epoch for one process start.</summary>
    public static string NewEpoch() =>
        Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();

    /// <summary>The delta for this tick, or null when there is nothing to send.</summary>
    public TelemetryDelta? Tick(IReadOnlyDictionary<int, TelemetrySample> read, long nowMs)
    {
        if (!HasDemand || _demand.Count == 0 || read.Count == 0) return null;

        var full = new List<(int Id, TelemetrySample Sample)>();
        var confirm = new List<(int Id, int AgeMs)>();
        foreach (var (id, sample) in read.OrderBy(kv => kv.Key))
        {
            if (!_demand.Contains(id)) continue;
            if (_sent.TryGetValue(id, out var last)
                && last.Value == sample.Value && last.State == sample.State)
            {
                if (nowMs - last.AtMs < ConfirmIntervalMs) continue;
                confirm.Add((id, sample.AgeMs));
            }
            else
            {
                full.Add((id, sample));
            }
            _sent[id] = new Sent(sample.Value, sample.State, nowMs);
        }

        if (full.Count == 0 && confirm.Count == 0) return null;

        var defaultAge = DefaultAge(full.Select(f => f.Sample.AgeMs).Concat(confirm.Select(c => c.AgeMs)));
        return new TelemetryDelta
        {
            Epoch = Epoch,
            Seq = ++_seq,
            AgeMs = defaultAge,
            Changed = full.Select(f => new TelemetryChange
            {
                Id = f.Id,
                Value = f.Sample.Value,
                State = f.Sample.State,
                AgeMs = f.Sample.AgeMs == defaultAge ? null : f.Sample.AgeMs,
            }).ToList(),
            Touched = confirm.Where(c => c.AgeMs == defaultAge).Select(c => c.Id).ToArray(),
            TouchedAged = confirm.Where(c => c.AgeMs != defaultAge).SelectMany(c => new[] { c.Id, c.AgeMs }).ToArray(),
        };
    }

    /// <summary>Most frequent age of the entries going out, the smallest on ties.</summary>
    public static int DefaultAge(IEnumerable<int> ages) =>
        ages.GroupBy(a => a)
            .OrderByDescending(g => g.Count())
            .ThenBy(g => g.Key)
            .Select(g => g.Key)
            .FirstOrDefault();
}
