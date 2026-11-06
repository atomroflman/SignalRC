using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Flow;

namespace SignalRC.Overlay.Tests.Flow;

public class VehicleControllerReaderTests
{
    private static readonly VehicleInputDeviceState[] Devices =
    [
        new() { Key = "AA:BB:CC:DD:EE:FF/Wireless Controller", Name = "Wireless Controller", Connected = true },
        new() { Key = "11:22:33:44:55:66/Xbox Wireless Controller", Name = "Xbox Wireless Controller", Connected = false },
    ];

    [Theory]
    [InlineData("", 1)]
    [InlineData("wireless", 1)]
    [InlineData("xbox", 0)]
    [InlineData("aa:bb:cc", 1)]
    [InlineData("nothing", 0)]
    public void Counts_connected_controllers_matching_the_filter(string device, int expected) =>
        Assert.Equal(expected, VehicleControllerReader.CountConnected(Devices, device));
}
