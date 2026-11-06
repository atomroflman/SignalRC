using System.Globalization;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Input;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Whether a controller is connected to the vehicle (Bluetooth or USB, Docs/OnboardFlow.md):
/// "1"/"0", or the number of connected controllers. Without Device any controller counts.
/// </summary>
[TelemetryValue("", TelemetryDataType.Boolean)]
[TelemetryValue("", TelemetryDataType.Integer, Decimals = 0, When = "report=Count")]
public class VehicleControllerReader : TelemetryReaderBase
{
    private readonly VehicleInputService _inputs;

    /// <summary>
    /// Which controller: part of its name or its Bluetooth address (case-insensitive), e.g.
    /// "Wireless Controller" or "AA:BB:CC:DD:EE:FF". Empty: any controller.
    /// </summary>
    public string Device { get; set; } = string.Empty;

    /// <summary>What to report: Connected (1/0) or Count (number of connected controllers).</summary>
    public VehicleControllerReport Report { get; set; } = VehicleControllerReport.Connected;

    public VehicleControllerReader(ILogger<VehicleControllerReader> logger, VehicleInputService inputs) : base(logger)
    {
        _inputs = inputs;
    }

    /// <summary>Count of connected controllers that match <paramref name="device"/>.</summary>
    public static int CountConnected(IEnumerable<SignalRC.Shared.Flow.VehicleInputDeviceState> devices, string? device)
    {
        var filter = device?.Trim() ?? string.Empty;
        return devices.Count(d => d.Connected && (filter.Length == 0
            || d.Name.Contains(filter, StringComparison.OrdinalIgnoreCase)
            || d.Key.Contains(filter, StringComparison.OrdinalIgnoreCase)));
    }

    // The input service knows the state right now: always current.
    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey) =>
        new Dictionary<string, TelemetrySample> { [channelKey] = TelemetrySample.Valid(await ReadTelemetry()) };

    public override Task<string> ReadTelemetry()
    {
        var count = CountConnected(_inputs.States(), Device);
        return Task.FromResult(Report == VehicleControllerReport.Count
            ? count.ToString(CultureInfo.InvariantCulture)
            : count > 0 ? "1" : "0");
    }
}

public enum VehicleControllerReport
{
    Connected,
    Count,
}
