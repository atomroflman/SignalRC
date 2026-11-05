namespace SignalRC.Server.Telemetry.History;

/// <summary>
/// Limits the stored samples per channel to one row per <see cref="MinIntervalMs"/>
/// without losing peaks: of the samples that arrive within an interval the one
/// furthest from the last stored value is written, the newest one follows in a
/// later interval. The limit counts emissions, not row times, so it holds
/// strictly. A gap (NaN) always counts as furthest. A value that is only
/// confirmed is repeated every <see cref="KeepAliveMs"/> so a reader can tell
/// "unchanged" from "no data". Times are Unix milliseconds; stored rows of a
/// channel never go back in time. Not thread safe.
/// </summary>
public sealed class TelemetryThrottle
{
    public const int MinIntervalMs = 100;
    public const int KeepAliveMs = 1000;

    private sealed class Channel
    {
        public long LastWritten = long.MinValue;
        /// <summary>When the last row was emitted (its own time or the later trigger).</summary>
        public long LastEmit = long.MinValue;
        public double LastValue = double.NaN;
        public bool HasPending;
        public (long Time, double Value) Peak;
        public (long Time, double Value) Latest;
    }

    private readonly Dictionary<int, Channel> _channels = [];

    /// <summary>A sample arrived; rows to store now are added to <paramref name="rows"/>.</summary>
    public void Offer(int id, long time, double value, bool touched, List<(long Time, double Value)> rows)
    {
        if (!_channels.TryGetValue(id, out var ch)) _channels[id] = ch = new Channel();
        if (ch.LastWritten != long.MinValue && time <= ch.LastWritten) time = ch.LastWritten + 1;
        if (ch.HasPending && time <= ch.Latest.Time) time = ch.Latest.Time + 1;

        if (touched)
        {
            // Only confirmed: a pending change is written later anyway, with its own time.
            if (ch.HasPending && Same(value, ch.Latest.Value)) return;
            if (!ch.HasPending && ch.LastWritten != long.MinValue && Same(value, ch.LastValue))
            {
                if (time - ch.LastWritten >= KeepAliveMs) rows.Add(Write(ch, time, value));
                return;
            }
        }

        if (ch.HasPending && time - ch.LastEmit >= MinIntervalMs) rows.Add(EmitPending(ch, time));
        if (!ch.HasPending && (ch.LastEmit == long.MinValue || time - ch.LastEmit >= MinIntervalMs))
        {
            rows.Add(Write(ch, time, value));
            return;
        }
        if (!ch.HasPending)
        {
            ch.HasPending = true;
            ch.Peak = ch.Latest = (time, value);
            return;
        }
        ch.Latest = (time, value);
        if (Distance(value, ch.LastValue) > Distance(ch.Peak.Value, ch.LastValue)) ch.Peak = (time, value);
    }

    /// <summary>Pending values whose interval has passed by <paramref name="now"/>, at most one per channel.</summary>
    public List<(int Id, long Time, double Value)> Flush(long now)
    {
        var result = new List<(int, long, double)>();
        foreach (var (id, ch) in _channels)
        {
            if (!ch.HasPending || now - ch.LastEmit < MinIntervalMs) continue;
            var (t, v) = EmitPending(ch, now);
            result.Add((id, t, v));
        }
        return result;
    }

    /// <summary>Writes the peak; the newest sample stays pending if it is a different one.</summary>
    private static (long, double) EmitPending(Channel ch, long now)
    {
        var peak = ch.Peak;
        var latest = ch.Latest;
        var row = Write(ch, peak.Time, peak.Value);
        ch.LastEmit = Math.Max(now, peak.Time);
        if (latest.Time != peak.Time)
        {
            ch.HasPending = true;
            ch.Peak = ch.Latest = latest;
        }
        return row;
    }

    private static (long, double) Write(Channel ch, long time, double value)
    {
        ch.LastWritten = time;
        ch.LastEmit = Math.Max(ch.LastEmit, time);
        ch.LastValue = value;
        ch.HasPending = false;
        return (time, value);
    }

    private static double Distance(double a, double last)
    {
        if (double.IsNaN(a) && double.IsNaN(last)) return 0;
        if (double.IsNaN(a) || double.IsNaN(last)) return double.PositiveInfinity;
        return Math.Abs(a - last);
    }

    private static bool Same(double a, double b) => a.Equals(b); // NaN equals NaN here
}
