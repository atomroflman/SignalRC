namespace SignalRC.Server.Telemetry.History;

/// <summary>
/// Stores only the changes of a text channel, at most one per
/// <see cref="TelemetryThrottle.MinIntervalMs"/>. A change within the interval
/// waits and is replaced by a later one, so the newest state is never lost; a
/// change that returns to the stored state before it was written is dropped.
/// Null is a gap (no valid value). Times are Unix milliseconds and never go
/// back. Not thread safe.
/// </summary>
public sealed class TextThrottle
{
    private const int MinIntervalMs = TelemetryThrottle.MinIntervalMs;

    private sealed class Channel
    {
        public bool Written;
        public long LastWritten = long.MinValue;
        public long LastEmit = long.MinValue;
        public string? LastValue;
        public (long Time, string? Value)? Pending;
    }

    private readonly Dictionary<int, Channel> _channels = [];

    /// <summary>A sample arrived; rows to store now are added to <paramref name="rows"/>.</summary>
    public void Offer(int id, long time, string? value, List<(long Time, string? Value)> rows)
    {
        if (!_channels.TryGetValue(id, out var ch)) _channels[id] = ch = new Channel();
        if (ch.Written && time <= ch.LastWritten) time = ch.LastWritten + 1;
        if (ch.Pending is { } p0 && time <= p0.Time) time = p0.Time + 1;

        if (ch.Pending is { } p && time - ch.LastEmit >= MinIntervalMs)
        {
            rows.Add(Write(ch, p.Time, p.Value, time));
        }
        var current = ch.Pending?.Value ?? ch.LastValue;
        if ((ch.Pending != null || ch.Written) && current == value) return;
        if (ch.Written && ch.Pending != null && value == ch.LastValue)
        {
            // Back to the stored state before the change was written: nothing changed.
            ch.Pending = null;
            return;
        }
        if (ch.Pending == null && (!ch.Written || time - ch.LastEmit >= MinIntervalMs))
        {
            rows.Add(Write(ch, time, value, time));
            return;
        }
        ch.Pending = (time, value); // the newest state, with its own time
    }

    /// <summary>Waiting changes whose interval has passed by <paramref name="now"/>.</summary>
    public List<(int Id, long Time, string? Value)> Flush(long now)
    {
        var result = new List<(int, long, string?)>();
        foreach (var (id, ch) in _channels)
        {
            if (ch.Pending is not { } p || now - ch.LastEmit < MinIntervalMs) continue;
            var (t, v) = Write(ch, p.Time, p.Value, now);
            result.Add((id, t, v));
        }
        return result;
    }

    private static (long, string?) Write(Channel ch, long time, string? value, long trigger)
    {
        ch.Written = true;
        ch.LastWritten = time;
        ch.LastEmit = Math.Max(trigger, time);
        ch.LastValue = value;
        ch.Pending = null;
        return (time, value);
    }
}
