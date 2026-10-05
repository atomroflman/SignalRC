using LteCar.Onboard.Telemetry;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Control.ControlTypes;

// ponytail: control channel whose received value is re-published as telemetry
// under the same channel name. Pair it with a StoreBackedTelemetryReader on
// the matching telemetry channel name to round-trip browser -> control flow
// -> onboard -> telemetry -> browser without any custom endpoint.
[ControlType("LoopbackToTelemetry")]
public class LoopbackToTelemetry : ControlTypeBase
{
    private readonly ILogger<LoopbackToTelemetry> _logger;
    private readonly TelemetryStore _store;

    public LoopbackToTelemetry(ILogger<LoopbackToTelemetry> logger, TelemetryStore store)
    {
        _logger = logger;
        _store = store;
    }

    public override string ToString() => $"Loopback@{Address}";

    public override void OnControlRecived(decimal newValue)
    {
        _store.Set(Name, newValue.ToString(System.Globalization.CultureInfo.InvariantCulture));
        _logger.LogInformation("Loopback {Channel} <- {Value}", Name, newValue);
    }

    public override void OnControlReleased()
    {
    }
}
