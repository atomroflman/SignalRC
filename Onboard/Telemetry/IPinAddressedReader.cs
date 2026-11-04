namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// A reader bound to one pin: TelemetryService hands it the channel's own "pinManager" and
/// "address" fields, so these readers need no options to find their pin.
/// </summary>
public interface IPinAddressedReader
{
    void Bind(string pinManager, int? address);
}
