using SignalRC.Shared.Telemetry;

namespace SignalRC.Server.Telemetry;

/// <summary>
/// Rate-limited diagnostics of the telemetry relay per vehicle
/// (Shared/Overlay/telemetry/README.md §5, "Diagnose"). At most one summary per
/// vehicle and interval on Information, the details of that window on Debug,
/// every single delta on Trace. Demand changes and new epochs are rare and
/// logged when they happen.
/// </summary>
public sealed class TelemetryRelayLog(ILogger logger, TimeProvider time)
{
    public const string Category = "SignalRC.Server.Telemetry.TelemetryRelay.Diagnostics";
    public static readonly TimeSpan Interval = TimeSpan.FromSeconds(5);

    private sealed class Window
    {
        public long EmittedAt = long.MinValue;
        public int Deltas, Changed, Touched, Legacy, DroppedOldSeq, Rejected, MaxValueLength;
        public string? Epoch;
        public long Seq = -1;
        public readonly SortedDictionary<int, int> ChangedLengths = [];
        public readonly SortedSet<int> TouchedIds = [];

        public void Reset(long now)
        {
            EmittedAt = now;
            Deltas = Changed = Touched = Legacy = DroppedOldSeq = Rejected = MaxValueLength = 0;
            ChangedLengths.Clear();
            TouchedIds.Clear();
        }
    }

    private readonly Dictionary<int, Window> _windows = [];

    private long Now => time.GetTimestamp() * 1000 / time.TimestampFrequency;

    private Window Get(int carId)
    {
        if (!_windows.TryGetValue(carId, out var w)) _windows[carId] = w = new Window();
        return w;
    }

    /// <summary>An accepted delta; <paramref name="names"/> resolves channel ids for the details.</summary>
    public void Delta(int carId, TelemetryDelta delta, IReadOnlyDictionary<int, string> names)
    {
        if (!logger.IsEnabled(LogLevel.Information)) return;
        if (logger.IsEnabled(LogLevel.Trace))
        {
            logger.LogTrace("Telemetry car {CarId}: delta epoch {Epoch} seq {Seq} age {AgeMs} ms, changed [{Changed}], touched [{Touched}], touchedAged [{TouchedAged}]",
                carId, delta.Epoch, delta.Seq, delta.AgeMs,
                string.Join(", ", delta.Changed.Select(c => $"{c.Id}:{Name(names, c.Id)} {c.State} len {c.Value?.Length ?? 0}")),
                string.Join(", ", delta.Touched), string.Join(", ", delta.TouchedAged));
        }
        lock (_windows)
        {
            var w = Get(carId);
            w.Deltas++;
            w.Changed += delta.Changed.Count;
            w.Touched += delta.Touched.Length + delta.TouchedAged.Length / 2;
            w.Epoch = delta.Epoch;
            w.Seq = delta.Seq;
            foreach (var c in delta.Changed)
            {
                var length = c.Value?.Length ?? 0;
                w.ChangedLengths[c.Id] = Math.Max(length, w.ChangedLengths.GetValueOrDefault(c.Id));
                w.MaxValueLength = Math.Max(w.MaxValueLength, length);
            }
            foreach (var id in delta.Touched) w.TouchedIds.Add(id);
            for (var i = 0; i + 1 < delta.TouchedAged.Length; i += 2) w.TouchedIds.Add(delta.TouchedAged[i]);
            Flush(carId, w, names);
        }
    }

    public void LegacyValue(int carId, IReadOnlyDictionary<int, string> names)
    {
        if (!logger.IsEnabled(LogLevel.Information)) return;
        lock (_windows)
        {
            var w = Get(carId);
            w.Legacy++;
            Flush(carId, w, names);
        }
    }

    public void DroppedOldSeq(int carId, TelemetryDelta delta, long lastSeq, IReadOnlyDictionary<int, string> names)
    {
        if (!logger.IsEnabled(LogLevel.Information)) return;
        logger.LogTrace("Telemetry car {CarId}: dropped delta seq {Seq} (last {LastSeq}, epoch {Epoch})", carId, delta.Seq, lastSeq, delta.Epoch);
        lock (_windows)
        {
            var w = Get(carId);
            w.DroppedOldSeq++;
            Flush(carId, w, names);
        }
    }

    /// <summary>A delta from a connection that is not the registered onboard; the claimed car where known, else 0.</summary>
    public void Rejected(int claimedCarId)
    {
        if (!logger.IsEnabled(LogLevel.Information)) return;
        lock (_windows)
        {
            var w = Get(claimedCarId);
            w.Rejected++;
            Flush(claimedCarId, w, new Dictionary<int, string>());
        }
    }

    public void NewEpoch(int carId, string? previous, string epoch) =>
        logger.LogInformation("Telemetry car {CarId}: new onboard epoch {Epoch} (was {Previous}), cache reset", carId, epoch, previous ?? "-");

    public void Demand(int carId, int[] previous, int[] demand) =>
        logger.LogInformation("Telemetry car {CarId}: demand to onboard [{Demand}] (was [{Previous}])", carId, string.Join(", ", demand), string.Join(", ", previous));

    private void Flush(int carId, Window w, IReadOnlyDictionary<int, string> names)
    {
        var now = Now;
        if (w.EmittedAt != long.MinValue && now - w.EmittedAt < Interval.TotalMilliseconds) return;
        var windowMs = w.EmittedAt == long.MinValue ? 0 : now - w.EmittedAt;
        logger.LogInformation(
            "Telemetry car {CarId}: {Deltas} deltas in {WindowMs} ms (changed {Changed}, touched {Touched}, legacy values {Legacy}), dropped {DroppedOldSeq} with old seq, rejected {Rejected} of foreign origin; epoch {Epoch} seq {Seq}, longest value {MaxValueLength} chars",
            carId, w.Deltas, windowMs, w.Changed, w.Touched, w.Legacy, w.DroppedOldSeq, w.Rejected, w.Epoch ?? "-", w.Seq, w.MaxValueLength);
        if (logger.IsEnabled(LogLevel.Debug) && (w.ChangedLengths.Count > 0 || w.TouchedIds.Count > 0))
        {
            logger.LogDebug("Telemetry car {CarId}: changed channels [{Changed}], touched channels [{Touched}]",
                carId,
                string.Join(", ", w.ChangedLengths.Select(kv => $"{kv.Key}:{Name(names, kv.Key)} len {kv.Value}")),
                string.Join(", ", w.TouchedIds));
        }
        w.Reset(now);
    }

    private static string Name(IReadOnlyDictionary<int, string> names, int id) => names.GetValueOrDefault(id) ?? "?";
}
