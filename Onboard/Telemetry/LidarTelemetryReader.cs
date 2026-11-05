using SignalRC.Shared.Channels;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Publishes the lidar, heavily reduced.
///
/// A revolution is 1440 values five times a second. The telemetry path carries
/// key-value pairs per channel, so sending that raw would be 7200 channel
/// updates a second for something a person looks at - and it would crowd out
/// the drive telemetry that matters.
///
/// So: one channel, one compact string of sector minima, at whatever
/// readIntervalTicks sets. 2 Hz is plenty for a display.
///
/// Nothing safety related may hang off this reader. A collision loop runs
/// locally, at full rate and full resolution, from the same manager - this is
/// for the operator, not for the vehicle.
/// </summary>
[TelemetryValue("lidarOk", TelemetryDataType.Boolean)]
[TelemetryValue("lidarRpm", TelemetryDataType.Number, "rpm", Decimals = 1)]
[TelemetryValue("lidarGaps", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarScans", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarCrcErrors", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarDiscarded", TelemetryDataType.Integer, "B", Decimals = 0)]
[TelemetryValue("lidarSeqGaps", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarReconnects", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarNeedsPowerCycle", TelemetryDataType.Boolean)]
[TelemetryValue("lidarProblem", TelemetryDataType.String)]
[TelemetryValue("lidarAge", TelemetryDataType.Number, "s", Decimals = 2)]
[TelemetryValue("lidarState", TelemetryDataType.String)]
[TelemetryValue("lidarPicoDropped", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarPicoFramesBad", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarPicoOverruns", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarPowerOn", TelemetryDataType.Boolean)]
[TelemetryValue("lidarFrames", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarMissingFrames", TelemetryDataType.Integer, Decimals = 0)]
[TelemetryValue("lidarComplete", TelemetryDataType.Boolean)]
[TelemetryValue("lidarSectors", TelemetryDataType.String)]
[TelemetryValue("lidarNearest", TelemetryDataType.Integer, "cm", Decimals = 0)]
[TelemetryValue("lidarNearestAngle", TelemetryDataType.Number, "°", Decimals = 0)]
[TelemetryValue("lidarFront", TelemetryDataType.Integer, "cm", Decimals = 0)]
public class LidarTelemetryReader : TelemetryReaderBase
{
    private readonly IModuleManagerFactory _factory;
    private ILidarSource? _source;
    private bool _warned;

    /// <summary>Name of the pinManager entry holding the lidar.</summary>
    public string PinManager { get; set; } = "lidar";

    /// <summary>Slices the 360 degrees are cut into. 36 gives 10 degrees each
    /// and a string of about 150 characters.</summary>
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
        var values = BuildValues(source.Health, source.LatestScan);
        return Task.FromResult<IReadOnlyDictionary<string, string>?>(values);
    }

    public override Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var source = Resolve();
        if (source == null) return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(null);
        var health = source.Health;
        var scan = source.LatestScan;
        var samples = BuildSamples(BuildValues(health, scan), health, scan != null);
        return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(samples);
    }

    // Values computed from the latest revolution. Everything else is the
    // manager's (or the Pico's) diagnostic state.
    private static readonly HashSet<string> ScanKeys = new(StringComparer.Ordinal)
    {
        "lidarRpm", "lidarGaps", "lidarFrames", "lidarMissingFrames", "lidarComplete",
        "lidarSectors", "lidarNearest", "lidarNearestAngle", "lidarFront",
    };

    // From the Pico's last status frame, which carries no receive time.
    private static readonly HashSet<string> PicoKeys = new(StringComparer.Ordinal)
    {
        "lidarState", "lidarPicoDropped", "lidarPicoFramesBad", "lidarPicoOverruns", "lidarPowerOn",
    };

    /// <summary>
    /// Quality of the lidar values (telemetry/README.md §3):
    /// <list type="bullet">
    /// <item>Scan values: Error while the port is closed or the manager reports
    /// a problem, NoData before the first revolution, Stale when the sensor no
    /// longer spins (a standstill no deadline can heal), else Valid. The age is
    /// <see cref="LidarHealth.ScanAgeSeconds"/> in every case.</item>
    /// <item>Pico counters: Unchecked, the status frame has no timestamp.</item>
    /// <item><c>lidarAge</c>: NoData before the first revolution.</item>
    /// <item>Health and counters (<c>lidarOk</c>, <c>lidarProblem</c>, ...):
    /// judged now, Valid with age 0.</item>
    /// </list>
    /// </summary>
    public static Dictionary<string, TelemetrySample> BuildSamples(
        IReadOnlyDictionary<string, string> values, LidarHealth health, bool hasScan)
    {
        var noScan = !hasScan || double.IsInfinity(health.ScanAgeSeconds);
        var scanAge = noScan ? 0 : TelemetrySample.AgeFromSeconds(health.ScanAgeSeconds);
        var scanState =
            !health.PortOpen || health.Problem != null ? TelemetrySampleState.Error
            : noScan ? TelemetrySampleState.NoData
            : !health.Spinning ? TelemetrySampleState.Stale
            : TelemetrySampleState.Valid;

        var samples = new Dictionary<string, TelemetrySample>(values.Count, StringComparer.Ordinal);
        foreach (var (key, value) in values)
        {
            samples[key] =
                ScanKeys.Contains(key) ? new TelemetrySample(value, scanState, scanAge)
                : PicoKeys.Contains(key) ? new TelemetrySample(value, TelemetrySampleState.Unchecked, 0)
                : key == "lidarAge" && double.IsInfinity(health.ScanAgeSeconds)
                    ? new TelemetrySample(value, TelemetrySampleState.NoData, 0)
                : TelemetrySample.Valid(value);
        }
        return samples;
    }

    /// <summary>The plain values (legacy view).</summary>
    public Dictionary<string, string> BuildValues(LidarHealth h, LidarScan? scan)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["lidarOk"] = h is { PortOpen: true, Spinning: true } ? "1" : "0",
            ["lidarRpm"] = h.Rpm.ToString("0.#", CultureInfo.InvariantCulture),
            ["lidarGaps"] = h.Gaps.ToString(CultureInfo.InvariantCulture),
            ["lidarScans"] = h.Scans.ToString(CultureInfo.InvariantCulture),
            ["lidarCrcErrors"] = h.CrcErrors.ToString(CultureInfo.InvariantCulture),
            ["lidarDiscarded"] = h.BytesDiscarded.ToString(CultureInfo.InvariantCulture),
            // Climbing means this host is not keeping up, or something else has
            // the port open. That is not a theoretical failure here: the first
            // capture taken on this hardware was two thirds corrupt because a
            // GUI still held it.
            ["lidarSeqGaps"] = h.SequenceGaps.ToString(CultureInfo.InvariantCulture),
            ["lidarReconnects"] = h.Reconnects.ToString(CultureInfo.InvariantCulture),
            ["lidarNeedsPowerCycle"] = h.NeedsPowerCycle ? "1" : "0",
            ["lidarProblem"] = h.Problem ?? string.Empty,
            ["lidarAge"] = double.IsInfinity(h.ScanAgeSeconds)
                ? string.Empty : h.ScanAgeSeconds.ToString("0.##", CultureInfo.InvariantCulture),
        };

        if (h.Pico is { } p)
        {
            values["lidarState"] = LidarProtocol.Describe(p.State);
            // The Pico's own drop counter. Separating "the bridge threw it
            // away" from "we never read it" is the difference between a USB
            // problem and a CPU problem.
            values["lidarPicoDropped"] = p.ScansDropped.ToString(CultureInfo.InvariantCulture);
            values["lidarPicoFramesBad"] = p.FramesBad.ToString(CultureInfo.InvariantCulture);
            values["lidarPicoOverruns"] = p.UartOverruns.ToString(CultureInfo.InvariantCulture);
            values["lidarPowerOn"] = p.PowerOn ? "1" : "0";
        }

        if (scan == null)
        {
            values["lidarSectors"] = string.Empty;
            values["lidarNearest"] = string.Empty;
            values["lidarNearestAngle"] = string.Empty;
            values["lidarFront"] = string.Empty;
            return values;
        }

        values["lidarFrames"] = scan.Frames.ToString(CultureInfo.InvariantCulture);
        values["lidarMissingFrames"] = scan.MissingFrames.ToString(CultureInfo.InvariantCulture);
        values["lidarComplete"] = scan.Complete ? "1" : "0";

        // Centimetres, not millimetres: half the digits for a resolution no
        // display uses, on a string sent several times a second.
        var minima = scan.SectorMinima(Sectors);
        var sb = new StringBuilder(Sectors * 4);
        for (var i = 0; i < minima.Length; i++)
        {
            if (i > 0) sb.Append(',');
            // -1 travels as -1: an empty sector is "nothing within range",
            // the opposite of an obstacle, and must never read as 0.
            sb.Append(minima[i] == LidarScan.Missing ? -1 : minima[i] / 10);
        }
        values["lidarSectors"] = sb.ToString();

        var nearest = int.MaxValue;
        var nearestIndex = -1;
        var front = int.MaxValue;
        var halfSpan = (int)(FrontHalfAngle / LidarProtocol.DegreesPerPoint);
        for (var i = 0; i < LidarProtocol.PointsPerRevolution; i++)
        {
            var d = scan.DistanceMm[i];
            if (d == LidarScan.Missing) continue;
            if (d < nearest) { nearest = d; nearestIndex = i; }
            // Straight ahead is slot 0, so the forward sector wraps.
            var off = Math.Min(i, LidarProtocol.PointsPerRevolution - i);
            if (off <= halfSpan && d < front) front = d;
        }

        values["lidarNearest"] = nearest == int.MaxValue
            ? string.Empty : (nearest / 10).ToString(CultureInfo.InvariantCulture);
        values["lidarNearestAngle"] = nearestIndex < 0
            ? string.Empty
            : LidarScan.AngleOf(nearestIndex).ToString("0.##", CultureInfo.InvariantCulture);
        values["lidarFront"] = front == int.MaxValue
            ? string.Empty : (front / 10).ToString(CultureInfo.InvariantCulture);

        return values;
    }

    private ILidarSource? Resolve()
    {
        if (_source != null) return _source;
        if (_factory.Create(PinManager) is ILidarSource source)
        {
            _source = source;
            if (source is LidarManager m) m.EnsureStarted();
            return source;
        }
        if (!_warned)
        {
            _warned = true;
            Logger.LogError(
                "pinManager '{Name}' is not a LidarManager. The telemetry channel's " +
                "pinManager option has to name the lidar entry in the ChannelMap.", PinManager);
        }
        return null;
    }
}
