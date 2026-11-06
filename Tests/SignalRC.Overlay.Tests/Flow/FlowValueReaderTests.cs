using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Overlay.Tests.Flow;

public class FlowValueReaderTests
{
    [Fact]
    public void No_value_yet_is_no_data()
    {
        Assert.Equal(TelemetrySampleState.NoData, FlowValueReader.Sample(null, 2000).State);
    }

    [Fact]
    public void Fresh_value_is_valid_old_one_stale()
    {
        var fresh = FlowValueReader.Sample((0.5, 100), 2000);
        Assert.Equal(("0.5", TelemetrySampleState.Valid, 100), (fresh.Value, fresh.State, fresh.AgeMs));
        Assert.Equal(TelemetrySampleState.Stale, FlowValueReader.Sample((0.5, 2500), 2000).State);
        Assert.Equal("1234.5", FlowValueReader.Sample((1234.5, 0), 2000).Value);
        Assert.Equal("0", FlowValueReader.Sample((double.NaN, 0), 2000).Value);
    }
}
