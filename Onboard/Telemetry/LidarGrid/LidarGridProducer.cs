using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry.LidarGrid;

/// <summary>
/// Turns the latest raw revolution into the grid sample (lidar/README.md §1, §5).
/// Pure apart from its own memory of the last scan and the last emitted grid;
/// the clock is passed in.
/// <list type="bullet">
/// <item>Each scan is processed once. Without a new scan there is no sample,
/// so the age keeps growing and nothing is confirmed.</item>
/// <item>Exception: when the state changes without a scan (port closed,
/// sensor stalled), the last value goes out once with the new state.
/// Otherwise Error and Stale could never be reported.</item>
/// <item>Deadband (D62): a new grid within 2 cm of the last emitted one
/// repeats the emitted value, which the delta tracker turns into a
/// confirmation.</item>
/// </list>
/// </summary>
public sealed class LidarGridProducer(LidarGridOptions options)
{
    private uint _sequence;
    private DateTime _scanUtc = DateTime.MinValue;
    private bool _haveScan;
    private ushort[]? _emittedCm;
    private bool _emittedComplete;
    private string _value = string.Empty;
    private TelemetrySampleState? _state;

    public LidarGridOptions Options { get; } = options;

    /// <summary>Value of the last sample (empty before the first scan).</summary>
    public string Value => _value;

    public TelemetrySample? Next(LidarHealth health, LidarScan? raw, DateTime nowUtc)
    {
        var isNew = raw != null && (!_haveScan || raw.Sequence != _sequence || raw.ReceivedUtc != _scanUtc);
        if (isNew)
        {
            _haveScan = true;
            _sequence = raw!.Sequence;
            _scanUtc = raw.ReceivedUtc;
            var grid = LidarGridBuilder.Build(raw, Options);
            var cm = LidarGridWire.ToCm(grid);
            if (_emittedCm == null || !LidarGridWire.WithinDeadband(_emittedCm, _emittedComplete, cm, grid.Complete))
            {
                _emittedCm = cm;
                _emittedComplete = grid.Complete;
                _value = LidarGridWire.Encode(cm, grid.Complete);
            }
        }

        var state = StateOf(health);
        if (!isNew && state == _state) return null;
        _state = state;
        var age = _haveScan ? TelemetrySample.AgeFromUtc(_scanUtc, nowUtc) : 0;
        return new TelemetrySample(_value, state, age);
    }

    /// <summary>Same mapping as the other LiDAR values (telemetry/README.md §4).</summary>
    private TelemetrySampleState StateOf(LidarHealth health) =>
        !health.PortOpen || health.Problem != null ? TelemetrySampleState.Error
        : !_haveScan ? TelemetrySampleState.NoData
        : !health.Spinning ? TelemetrySampleState.Stale
        : TelemetrySampleState.Valid;
}
