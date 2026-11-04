namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Remaining runtime from a rolling average of the battery current, so the value doesn't jump with
/// every throttle input. Time-weighted, because a BMS read can take seconds or fail. The history is
/// in memory and starts over with the Onboard.
/// </summary>
public sealed class BatteryRuntimeEstimator
{
    public static readonly TimeSpan Window = TimeSpan.FromHours(1);
    // Before this, a single burst would decide the estimate.
    public static readonly TimeSpan MinSpan = TimeSpan.FromMinutes(1);
    // Nothing is known about a longer gap, so it doesn't count towards the average.
    public static readonly TimeSpan MaxGap = TimeSpan.FromMinutes(5);
    // Below this the battery is about idle and the estimate would be meaningless.
    public const double MinDischargeAmps = 0.05;

    private readonly Queue<(DateTime AtUtc, double Amps)> _samples = new();
    private readonly object _lock = new();

    /// <summary><paramref name="amps"/>: as the BMS reports it, negative while discharging.</summary>
    public void Add(DateTime atUtc, double amps)
    {
        if (!double.IsFinite(amps)) return;
        lock (_lock)
        {
            _samples.Enqueue((atUtc, amps));
            while (_samples.Count > 0 && atUtc - _samples.Peek().AtUtc > Window)
                _samples.Dequeue();
        }
    }

    /// <summary>Average current in the window; null until <see cref="MinSpan"/> is covered.</summary>
    public double? AverageAmps()
    {
        lock (_lock)
        {
            var seconds = 0d;
            var ampSeconds = 0d;
            (DateTime AtUtc, double Amps)? previous = null;
            foreach (var sample in _samples)
            {
                if (previous is { } p && sample.AtUtc - p.AtUtc <= MaxGap)
                {
                    var span = (sample.AtUtc - p.AtUtc).TotalSeconds;
                    seconds += span;
                    ampSeconds += span * (p.Amps + sample.Amps) / 2;
                }
                previous = sample;
            }
            return seconds >= MinSpan.TotalSeconds ? ampSeconds / seconds : null;
        }
    }

    /// <summary>Hours until empty; null while charging or about idle, where no runtime exists.</summary>
    public static double? RuntimeHours(double remainingAh, double? averageAmps)
    {
        if (averageAmps is not { } amps || amps > -MinDischargeAmps || !double.IsFinite(remainingAh) || remainingAh < 0)
            return null;
        return remainingAh / -amps;
    }
}
