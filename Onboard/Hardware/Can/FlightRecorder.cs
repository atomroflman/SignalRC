using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Hardware.Can;

/// <summary>
/// Keeps the last stretch of drive state in memory and writes it out when
/// something goes wrong.
///
/// During a drive there is no serial console, no logic analyser and no
/// oscilloscope - the vehicle is a hundred metres away and all that comes back
/// is video and a few telemetry numbers at 1 Hz. Without a recording, every
/// incident is "it stuttered, no idea why".
///
/// That is the one lesson this project has already paid for twice. Four rounds
/// were burned on the stall detector before anyone printed its internals, and
/// the velocity estimate was wrong for half the project because nobody
/// compared reported speed against the angle. Both were found the moment the
/// data was visible, not the moment someone had a better theory.
///
/// So: a ring buffer, and a dump on every latched fault. Cheap, and it pays
/// for itself the first time something happens once and cannot be reproduced.
/// </summary>
public sealed class FlightRecorder
{
    private readonly ILogger _logger;
    private readonly Sample[] _ring;
    private readonly object _lock = new();
    private int _next;
    private int _count;
    private DateTime _lastDumpUtc = DateTime.MinValue;

    /// <summary>Where the dumps go. Empty disables writing but keeps the ring,
    /// so a dump can still be requested by hand.</summary>
    public string Directory { get; set; } = string.Empty;

    /// <summary>Dumps closer together than this are dropped. One blocked track
    /// produces a burst of faults on both nodes, and twenty files of the same
    /// second help nobody.</summary>
    public int MinDumpIntervalSeconds { get; set; } = 10;

    /// <summary>How many dumps to keep before the oldest is deleted. The Pi's
    /// card is not large and nobody prunes a log directory by hand.</summary>
    public int KeepFiles { get; set; } = 20;

    public FlightRecorder(ILogger logger, int capacity)
    {
        _logger = logger;
        _ring = new Sample[Math.Max(16, capacity)];
    }

    public readonly record struct Sample(
        double T,
        float LeftSpeed, float LeftTarget, float LeftCurrent, float LeftTemp, float LeftThermal,
        byte LeftState, byte LeftFlags, byte LeftFault,
        float RightSpeed, float RightTarget, float RightCurrent, float RightTemp, float RightThermal,
        byte RightState, byte RightFlags, byte RightFault,
        float BusVolts, float BusAmps,
        float LeftCurrentD, float RightCurrentD,
        byte LeftHallErr, byte RightHallErr,
        float CommandLeft, float CommandRight, byte Mode,
        float ControlAge, byte DriveEnabled, string? Inhibit);

    public void Add(in Sample s)
    {
        lock (_lock)
        {
            _ring[_next] = s;
            _next = (_next + 1) % _ring.Length;
            if (_count < _ring.Length) _count++;
        }
    }

    /// <summary>
    /// Writes the buffer out. Returns the path, or null if nothing was written.
    /// Call it off the command loop - this touches the file system.
    /// </summary>
    public string? Dump(string reason)
    {
        if (string.IsNullOrWhiteSpace(Directory)) return null;

        Sample[] samples;
        lock (_lock)
        {
            var now = DateTime.UtcNow;
            if ((now - _lastDumpUtc).TotalSeconds < MinDumpIntervalSeconds) return null;
            _lastDumpUtc = now;

            samples = new Sample[_count];
            var start = (_next - _count + _ring.Length) % _ring.Length;
            for (var i = 0; i < _count; i++)
            {
                samples[i] = _ring[(start + i) % _ring.Length];
            }
        }

        if (samples.Length == 0) return null;

        try
        {
            System.IO.Directory.CreateDirectory(Directory);
            var safe = new string(reason.Select(c => char.IsLetterOrDigit(c) ? c : '-').ToArray());
            var path = Path.Combine(Directory,
                $"drive-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{safe}.csv");

            var sb = new StringBuilder(samples.Length * 160);
            sb.AppendLine("# reason=" + reason);
            sb.AppendLine("t,lSpeed,lTarget,lCurrent,lTemp,lThermal,lState,lFlags,lFault," +
                          "rSpeed,rTarget,rCurrent,rTemp,rThermal,rState,rFlags,rFault," +
                          "busV,busA,lId,rId,lHallErr,rHallErr," +
                          "cmdL,cmdR,mode,ctrlAge,enabled,inhibit");
            foreach (var s in samples)
            {
                sb.Append(F(s.T)).Append(',')
                  .Append(F(s.LeftSpeed)).Append(',').Append(F(s.LeftTarget)).Append(',')
                  .Append(F(s.LeftCurrent)).Append(',').Append(F(s.LeftTemp)).Append(',')
                  .Append(F(s.LeftThermal)).Append(',')
                  .Append(s.LeftState).Append(',').Append(s.LeftFlags).Append(',')
                  .Append(s.LeftFault).Append(',')
                  .Append(F(s.RightSpeed)).Append(',').Append(F(s.RightTarget)).Append(',')
                  .Append(F(s.RightCurrent)).Append(',').Append(F(s.RightTemp)).Append(',')
                  .Append(F(s.RightThermal)).Append(',')
                  .Append(s.RightState).Append(',').Append(s.RightFlags).Append(',')
                  .Append(s.RightFault).Append(',')
                  .Append(F(s.BusVolts)).Append(',').Append(F(s.BusAmps)).Append(',')
                  .Append(F(s.LeftCurrentD)).Append(',').Append(F(s.RightCurrentD)).Append(',')
                  .Append(s.LeftHallErr).Append(',').Append(s.RightHallErr).Append(',')
                  .Append(F(s.CommandLeft)).Append(',').Append(F(s.CommandRight)).Append(',')
                  .Append(s.Mode).Append(',')
                  .Append(F(s.ControlAge)).Append(',').Append(s.DriveEnabled).Append(',')
                  .Append(s.Inhibit ?? string.Empty)
                  .AppendLine();
            }
            File.WriteAllText(path, sb.ToString());
            Prune();
            _logger.LogWarning("Flight recorder: {Count} samples written to {Path} ({Reason}).",
                samples.Length, path, reason);
            return path;
        }
        catch (Exception ex)
        {
            // A failed dump must never take the drive with it. The vehicle is
            // already in trouble if we got here.
            _logger.LogError(ex, "Flight recorder could not write a dump.");
            return null;
        }
    }

    private void Prune()
    {
        try
        {
            var files = new DirectoryInfo(Directory).GetFiles("drive-*.csv")
                .OrderByDescending(f => f.LastWriteTimeUtc).Skip(Math.Max(1, KeepFiles));
            foreach (var f in files) f.Delete();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Flight recorder could not prune old dumps.");
        }
    }

    private static string F(double v) => v.ToString("0.###", CultureInfo.InvariantCulture);
}
