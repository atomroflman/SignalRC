using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// The HUD's LiDAR source: groups and the compact grid from the newest raw
/// revolution (Shared/Overlay/lidar/README.md). Reads
/// <see cref="ILidarSource.LatestRawScan"/>, not the multi-scan filtered
/// <see cref="ILidarSource.LatestScan"/>, so the HUD gets no window latency
/// (D15). <see cref="LidarTelemetryReader"/> and the filter stay as they are.
///
/// Channel: <c>lidarGrid</c>, own groupKey <c>lidarGrid</c>,
/// readIntervalTicks 2 (at most 5 Hz, D16), DataType LidarGrid.
/// For display only; nothing safety related may depend on it.
/// </summary>
public class LidarGridTelemetryReader : TelemetryReaderBase
{
    public const string ChannelName = "lidarGrid";

    private readonly IModuleManagerFactory _factory;
    private ILidarSource? _source;
    private LidarGridProducer? _producer;
    private bool _warnedSource;
    private bool _warnedOptions;

    public string PinManager { get; set; } = "lidar";
    public double MountYawDeg { get; set; }
    public int[] ZoneLimitsMm { get; set; } = [.. LidarGridOptions.DefaultZoneLimitsMm];
    public int NeighborMaxMm { get; set; } = 50;
    public int MinGroupPoints { get; set; } = 3;
    /// <summary>Index direction of the scanner; provisional default (D58).</summary>
    public bool ScannerClockwise { get; set; } = true;

    public LidarGridTelemetryReader(ILogger<LidarGridTelemetryReader> logger, IModuleManagerFactory factory)
        : base(logger)
    {
        _factory = factory;
    }

    public LidarGridOptions Options => new()
    {
        MountYawDeg = MountYawDeg,
        ZoneLimitsMm = ZoneLimitsMm,
        NeighborMaxMm = NeighborMaxMm,
        MinGroupPoints = MinGroupPoints,
        ScannerClockwise = ScannerClockwise,
    };

    public override Task<string> ReadTelemetry() => Task.FromResult(string.Empty);

    /// <summary>Plain view for the probe tool: the grid of the newest raw scan, no deadband, no state.</summary>
    public override Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var options = Options;
        var raw = options.Validate().Count == 0 ? Resolve()?.LatestRawScan : null;
        if (raw == null) return Task.FromResult<IReadOnlyDictionary<string, string>?>(null);
        var value = LidarGridWire.Encode(LidarGridBuilder.Build(raw, options));
        return Task.FromResult<IReadOnlyDictionary<string, string>?>(Keyed(channelKey, value));
    }

    public override Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        var source = Resolve();
        if (source == null) return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(null);

        var producer = _producer ??= CreateProducer();
        if (producer == null)
        {
            // Invalid options are a configuration error of this source, reported once.
            if (_warnedOptions) return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(null);
            _warnedOptions = true;
            return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(
                Keyed(channelKey, new TelemetrySample(string.Empty, TelemetrySampleState.Error, 0)));
        }

        var sample = producer.Next(source.Health, source.LatestRawScan, DateTime.UtcNow);
        return Task.FromResult<IReadOnlyDictionary<string, TelemetrySample>?>(sample is { } s ? Keyed(channelKey, s) : null);
    }

    private LidarGridProducer? CreateProducer()
    {
        var options = Options;
        var errors = options.Validate();
        if (errors.Count == 0) return new LidarGridProducer(options);
        Logger.LogError("LiDAR grid options are invalid: {Errors}. The grid channel reports Error.", string.Join("; ", errors));
        return null;
    }

    // The service matches by channel name; the contract name is lidarGrid,
    // the groupKey normally the same.
    private static Dictionary<string, T> Keyed<T>(string channelKey, T value)
    {
        var values = new Dictionary<string, T>(StringComparer.Ordinal) { [ChannelName] = value };
        values[channelKey] = value;
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
        if (!_warnedSource)
        {
            _warnedSource = true;
            Logger.LogError(
                "pinManager '{Name}' is not a LidarManager. The lidarGrid channel's " +
                "pinManager option has to name the lidar entry in the ChannelMap.", PinManager);
        }
        return null;
    }
}
