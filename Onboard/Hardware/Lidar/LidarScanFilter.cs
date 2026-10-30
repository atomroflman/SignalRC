namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Cleans a revolution before anything acts on it.
///
/// A real obstacle is in the same direction on consecutive revolutions; a
/// sunlight artefact is not. Keeping a slot only when it returned something in
/// several of the last few scans removes the random ones, and taking the
/// MEDIAN of those distances rather than the latest rejects a single wild
/// value without needing a threshold for what counts as wild.
///
/// There is deliberately no strength gate. An earlier version had one, built
/// on the Neato format's per-sample signal strength - but this sensor does not
/// report one. The 62-byte frame it sends the Pico carries distances and
/// nothing else, so there is no quality number per point to threshold on. What
/// is available instead is per-revolution: frames received, frames missing and
/// the Pico's own counters, and those are surfaced as telemetry rather than
/// used to filter.
///
/// Two limits, both deliberate.
///
/// The window costs latency: three scans is 600 ms before a new obstacle is
/// believed. Acceptable for the parking and following this sensor is for, and
/// the reason collision work has to shorten or drop it as speed rises.
///
/// It also only means anything while the vehicle is roughly still. Turning on
/// the spot sweeps the world past a fixed angle, so a slot holds a different
/// object on every revolution and the window rejects everything. The filter
/// cannot tell on its own - it has no idea what the tracks are doing - so the
/// caller has to widen or disable it when the vehicle moves.
/// </summary>
public sealed class LidarScanFilter
{
    /// <summary>How many recent revolutions to consider. 1 disables the window.</summary>
    public int WindowScans { get; set; } = 1;

    /// <summary>How many of the window must carry a return for the slot to
    /// survive. Clamped to the window length.</summary>
    public int MinHits { get; set; } = 2;

    private int[][]? _window;
    private int _next;
    private int _filled;

    public long PointsIn { get; private set; }
    public long DroppedInconsistent { get; private set; }

    /// <summary>
    /// Returns a cleaned copy. The input is left alone so the raw scan stays
    /// available - a filter that destroys its own evidence cannot be judged,
    /// and this one will need tuning against real daylight.
    /// </summary>
    public LidarScan Apply(LidarScan scan)
    {
        var n = LidarProtocol.PointsPerRevolution;
        var window = Math.Max(1, WindowScans);
        var hits = Math.Clamp(MinHits, 1, window);

        if (_window == null || _window.Length != window)
        {
            _window = new int[window][];
            for (var i = 0; i < window; i++) _window[i] = new int[n];
            _next = 0;
            _filled = 0;
        }

        Array.Copy(scan.DistanceMm, _window[_next], n);
        PointsIn += n;
        _next = (_next + 1) % window;
        if (_filled < window) _filled++;

        var result = new LidarScan
        {
            Sequence = scan.Sequence,
            PicoTimeMs = scan.PicoTimeMs,
            Rpm = scan.Rpm,
            PointsValid = scan.PointsValid,
            Frames = scan.Frames,
            MissingFrames = scan.MissingFrames,
            Complete = scan.Complete,
            ReceivedUtc = scan.ReceivedUtc,
        };

        // Until the window has filled, require only what is available. A
        // sensor that reports nothing for the first half second after a
        // reconnect looks broken.
        var required = Math.Min(hits, _filled);
        var usable = 0;
        Span<int> gathered = stackalloc int[window];

        for (var a = 0; a < n; a++)
        {
            var count = 0;
            for (var w = 0; w < _filled; w++)
            {
                var d = _window[w][a];
                if (d != LidarScan.Missing) gathered[count++] = d;
            }

            if (count < required)
            {
                result.DistanceMm[a] = LidarScan.Missing;
                if (count > 0) DroppedInconsistent++;
                continue;
            }

            gathered[..count].Sort();
            result.DistanceMm[a] = gathered[count / 2];
            usable++;
        }

        result.UsableCount = usable;
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
