namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Cleans a scan before anything acts on it.
///
/// This is an indoor sensor pressed into outdoor service. Sunlight is
/// broadband and the laser is not, so ambient light raises the noise floor and
/// produces returns that were never surfaces - scattered, weak, and in a
/// different place on every revolution. Two cheap filters take most of that
/// out, and neither needs anything soldered.
///
/// **Strength gate.** Every sample carries a signal strength that nothing used
/// until now. A weak return outdoors is usually not a surface.
///
/// **Window.** A real obstacle is in the same direction on consecutive
/// revolutions. A sunlight artefact is not. Keeping a degree only when it
/// returned something in several of the last few scans removes the random
/// ones, and taking the MEDIAN of those distances rather than the latest
/// rejects a single wild value without needing a threshold for what counts as
/// wild.
///
/// The window costs latency: three scans is 600 ms before a new obstacle is
/// believed. That is acceptable for the parking and following this sensor is
/// meant for, and it is the reason the collision work has to shorten or drop
/// the window as speed rises - at which point the strength gate is all that
/// is left, which is also when the lidar should no longer be steering
/// anything.
///
/// It is also only meaningful while the vehicle is roughly still. Turning on
/// the spot sweeps the whole world past a fixed angle, so a degree holds a
/// different object on every revolution and the window rejects everything.
/// Whoever drives this has to widen or disable it when the vehicle is moving
/// quickly - the filter cannot tell on its own, because it has no idea what
/// the tracks are doing.
/// </summary>
public sealed class LdsScanFilter
{
    /// <summary>Samples below this are dropped. 0 disables the gate.</summary>
    public int MinStrength { get; set; }

    /// <summary>How many recent scans to consider. 1 disables the window.</summary>
    public int WindowScans { get; set; } = 1;

    /// <summary>How many of the window must carry a return for the degree to
    /// survive. Clamped to the window length.</summary>
    public int MinHits { get; set; } = 2;

    private int[][]? _window;
    private int _next;
    private int _filled;

    public long PointsIn { get; private set; }
    public long DroppedWeak { get; private set; }
    public long DroppedInconsistent { get; private set; }

    /// <summary>
    /// Returns a cleaned copy. The input is left alone so the raw scan stays
    /// available - a filter that destroys its own evidence cannot be judged.
    /// </summary>
    public LdsScan Apply(LdsScan scan)
    {
        var n = LdsProtocol.SamplesPerRevolution;
        var window = Math.Max(1, WindowScans);
        var hits = Math.Clamp(MinHits, 1, window);

        if (_window == null || _window.Length != window)
        {
            _window = new int[window][];
            for (var i = 0; i < window; i++) _window[i] = new int[n];
            _next = 0;
            _filled = 0;
        }

        // Strength gate first, so a weak sample never enters the window and
        // cannot prop up a direction that should have died.
        var current = _window[_next];
        for (var a = 0; a < n; a++)
        {
            PointsIn++;
            var d = scan.DistanceMm[a];
            if (d == LdsScan.Missing)
            {
                current[a] = LdsScan.Missing;
                continue;
            }
            if (MinStrength > 0 && scan.Strength[a] < MinStrength)
            {
                current[a] = LdsScan.Missing;
                DroppedWeak++;
                continue;
            }
            current[a] = d;
        }
        _next = (_next + 1) % window;
        if (_filled < window) _filled++;

        var result = new LdsScan { Rpm = scan.Rpm, CompletedUtc = scan.CompletedUtc };
        // Until the window has filled, require only what is available - a
        // sensor that reports nothing for the first half second after a
        // reconnect looks broken.
        var required = Math.Min(hits, _filled);
        var valid = 0;
        Span<int> gathered = stackalloc int[window];

        for (var a = 0; a < n; a++)
        {
            var count = 0;
            for (var w = 0; w < _filled; w++)
            {
                var d = _window[w][a];
                if (d != LdsScan.Missing) gathered[count++] = d;
            }

            if (count < required)
            {
                result.DistanceMm[a] = LdsScan.Missing;
                result.Strength[a] = 0;
                if (count > 0) DroppedInconsistent++;
                continue;
            }

            gathered[..count].Sort();
            result.DistanceMm[a] = gathered[count / 2];
            result.Strength[a] = scan.Strength[a];
            valid++;
        }

        result.ValidCount = valid;
        return result;
    }

    /// <summary>Forgets the window. Call it after a gap in the stream, where
    /// the old scans describe a world the vehicle has since driven out of.</summary>
    public void Reset()
    {
        _filled = 0;
        _next = 0;
    }
}
