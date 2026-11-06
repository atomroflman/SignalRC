using SignalRC.Onboard.Telemetry;

namespace SignalRC.Overlay.Tests.Flow;

public class PowerSupplyReaderTests
{
    [Fact]
    public void Parses_get_throttled()
    {
        Assert.Equal(0x50005u, PowerSupplyReader.ParseThrottled("throttled=0x50005\n"));
        Assert.Equal(0u, PowerSupplyReader.ParseThrottled("throttled=0x0"));
        Assert.Null(PowerSupplyReader.ParseThrottled("error"));
    }

    [Theory]
    [InlineData(PowerSupplyReport.Ok, 0x0u, "1")]
    [InlineData(PowerSupplyReport.Ok, 0x50005u, "0")]
    [InlineData(PowerSupplyReport.Ok, 0x50000u, "1")] // only in the past
    [InlineData(PowerSupplyReport.UnderVoltage, 0x1u, "1")]
    [InlineData(PowerSupplyReport.UnderVoltageSinceBoot, 0x10000u, "1")]
    [InlineData(PowerSupplyReport.UnderVoltageSinceBoot, 0x80000u, "0")]
    [InlineData(PowerSupplyReport.Throttled, 0x4u, "1")]
    [InlineData(PowerSupplyReport.Throttled, 0x80000u, "0")]
    [InlineData(PowerSupplyReport.ThrottledSinceBoot, 0x80000u, "1")] // soft temperature limit since boot
    [InlineData(PowerSupplyReport.Raw, 0x80000u, "0x80000")]
    public void Evaluates_the_bits(PowerSupplyReport report, uint bits, string expected) =>
        Assert.Equal(expected, PowerSupplyReader.Evaluate(report, bits));
}
