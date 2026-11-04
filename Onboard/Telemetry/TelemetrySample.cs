using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// One telemetry value with its source quality (Shared/Overlay/telemetry/README.md §3).
/// <paramref name="AgeMs"/> is how long ago the value was measured, taken from a
/// clock on this device - never by comparing clocks of different devices.
/// </summary>
public readonly record struct TelemetrySample(string Value, TelemetrySampleState State, int AgeMs)
{
    public static TelemetrySample Valid(string value, int ageMs = 0) => new(value, TelemetrySampleState.Valid, ageMs);

    /// <summary>Seconds to whole milliseconds, clamped to [0, int.MaxValue].</summary>
    public static int AgeFromSeconds(double seconds)
    {
        if (double.IsNaN(seconds) || seconds <= 0) return 0;
        var ms = seconds * 1000.0;
        return ms >= int.MaxValue ? int.MaxValue : (int)ms;
    }

    /// <summary>Age of a DateTime stamp taken on this device.</summary>
    public static int AgeFromUtc(DateTime stampUtc, DateTime nowUtc) => AgeFromSeconds((nowUtc - stampUtc).TotalSeconds);
}
