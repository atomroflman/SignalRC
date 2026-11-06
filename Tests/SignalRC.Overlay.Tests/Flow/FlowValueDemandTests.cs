using SignalRC.Server.Services;

namespace SignalRC.Overlay.Tests.Flow;

public class FlowValueDemandTests
{
    [Fact]
    public void Reports_first_and_last_viewer_per_vehicle()
    {
        var d = new FlowValueDemand();
        Assert.True(d.Add(1, "a"));
        Assert.False(d.Add(1, "b"));
        Assert.False(d.Add(1, "a"));
        Assert.True(d.Add(2, "a"));
        Assert.False(d.Remove(1, "a"));
        Assert.True(d.IsWanted(1));
        Assert.Equal([2], d.RemoveConnection("a"));
        Assert.True(d.Remove(1, "b"));
        Assert.False(d.IsWanted(1));
        Assert.False(d.Remove(1, "x"));
    }
}
