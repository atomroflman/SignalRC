using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Lidar;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Publishes the lidar, heavily reduced.
///
/// A full scan is 360 values five times a second. The telemetry path carries
/// key-value pairs per channel, so sending that raw would mean 1800 channel
/// updates a second for something a person looks at - absurd, and it would
/// crowd out the drive telemetry that actually matters.
///
/// So: one channel, one compact string of sector minima, at whatever rate
/// readIntervalTicks sets. 2 Hz is plenty for a display.
///
/// The minimum per sector, not the mean. What matters about a direction is the
/// nearest thing in it; averaging a wall at 3 m with a post at 0.4 m reports
/// 1.7 m, where there is nothing at all.
///
/// Nothing safety related may hang off this reader. A collision loop runs
/// locally, at full rate and full resolution, from the same manager - this is
/// for the operator, not for the vehicle.
/// </summary>
public class LidarTelemetryReader : TelemetryReaderBase
{
    private readonly IModuleManagerFactory _factory;
    private ILidarSource? _source;
    private bool _warned;

    /// <summary>Name of the pinManager entry holding the lidar.</summary>
    public string PinManager { get; set; } = "lidar";

    /// <summary>How many slices the 360 degrees are cut into. 36 gives 10
    /// degrees each and a string of about 150 characters.</summary>
    public int Sectors { get; set; } = 36;

    /// <summary>Half-width of the sector counted as "ahead", in degrees.</summary>
    public int FrontHalfAngle { get; set; } = 30;

    public LidarTelemetryReader(ILogger<LidarTelemetryReader> logger, IModuleManagerFactory factory)
        : base(logger)
    {
        _factory = factory;
    }

    public override Task<string> ReadTelemetry() => Task.FromResult(string.Empty);

    public override Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var source = Resolve();
        if (source == null) return Task.FromResult<IReadOnlyDictionary<string, string>?>(null);

        var health = source.Health;
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["lidarOk"] = health is { PortOpen: true, Spinning: true } ? "1" : "0",
            ["lidarRpm"] = health.Rpm.ToString("0.#", CultureInfo.InvariantCulture),
            ["lidarGaps"] = health.Gaps.ToString(CultureInfo.InvariantCulture),
            ["lidarScans"] = health.Scans.ToString(CultureInfo.InvariantCulture),
            ["lidarChecksumErrors"] = health.ChecksumErrors.ToString(CultureInfo.InvariantCulture),
            ["lidarIndexErrors"] = health.IndexErrors.ToString(CultureInfo.InvariantCulture),
            ["lidarReconnects"] = health.Reconnects.ToString(CultureInfo.InvariantCulture),
            ["lidarProblem"] = health.Problem ?? string.Empty,
            // Not a warning but a verdict: nothing on the vehicle can bring it
            // back, so the operator should stop waiting for it.
            ["lidarNeedsPowerCycle"] = health.NeedsPowerCycle ? "1" : "0",
            ["lidarDroppedWeak"] = health.DroppedWeak.ToString(CultureInfo.InvariantCulture),
            ["lidarDroppedInconsistent"] =
                health.DroppedInconsistent.ToString(CultureInfo.InvariantCulture),
            ["lidarAge"] = double.IsInfinity(health.ScanAgeSeconds)
                ? string.Empty
                : health.ScanAgeSeconds.ToString("0.##", CultureInfo.InvariantCulture),
        };

        var scan = source.LatestScan;
        if (scan == null)
        {
            values["lidarSectors"] = string.Empty;
            values["lidarNearest"] = string.Empty;
            values["lidarNearestAngle"] = string.Empty;
            values["lidarFront"] = string.Empty;
            return Task.FromResult<IReadOnlyDictionary<string, string>?>(values);
        }

        // Centimetres, not millimetres: half the digits for a resolution no
        // display uses, on a string that is sent several times a second.
        var minima = scan.SectorMinima(Sectors);
        var sb = new StringBuilder(Sectors * 4);
        for (var i = 0; i < minima.Length; i++)
        {
            if (i > 0) sb.Append(',');
            // -1 travels as -1: an empty sector is "nothing within range",
            // which is the opposite of an obstacle and must not read as 0.
            sb.Append(minima[i] == LdsScan.Missing ? -1 : minima[i] / 10);
        }
        values["lidarSectors"] = sb.ToString();

        var nearest = int.MaxValue;
        var nearestAngle = -1;
        var front = int.MaxValue;
        for (var a = 0; a < LdsProtocol.SamplesPerRevolution; a++)
        {
            var d = scan.DistanceMm[a];
            if (d == LdsScan.Missing) continue;
            if (d < nearest) { nearest = d; nearestAngle = a; }
            // Straight ahead is 0 degrees, so the front sector wraps.
            var off = a <= 180 ? a : 360 - a;
            if (off <= FrontHalfAngle && d < front) front = d;
        }

        values["lidarNearest"] = nearest == int.MaxValue
            ? string.Empty : (nearest / 10).ToString(CultureInfo.InvariantCulture);
        values["lidarNearestAngle"] = nearestAngle < 0
            ? string.Empty : nearestAngle.ToString(CultureInfo.InvariantCulture);
        values["lidarFront"] = front == int.MaxValue
            ? string.Empty : (front / 10).ToString(CultureInfo.InvariantCulture);

        return Task.FromResult<IReadOnlyDictionary<string, string>?>(values);
    }

    private ILidarSource? Resolve()
    {
        if (_source != null) return _source;
        if (_factory.Create(PinManager) is ILidarSource source)
        {
            _source = source;
            if (source is LdsLidarManager m) m.EnsureStarted();
            return source;
        }
        if (!_warned)
        {
            _warned = true;
            Logger.LogError(
                "pinManager '{Name}' is not an LdsLidarManager. The telemetry channel's " +
                "pinManager option has to name the lidar entry in the ChannelMap.", PinManager);
        }
        return null;
    }
}
