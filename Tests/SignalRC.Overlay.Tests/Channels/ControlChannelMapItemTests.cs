using SignalRC.Server.Controllers;
using SignalRC.Server.Data;

namespace SignalRC.Overlay.Tests.Channels;

// AP13: a control channel pushed after editing (UpsertControlChannel) must keep
// its server id, otherwise the onboard stores it without id and
// UpdateChannel(carId, session, id, value) no longer reaches it.
public sealed class ControlChannelMapItemTests
{
    [Fact]
    public void PushedControlChannelCarriesTheServerId()
    {
        var ch = new CarChannel
        {
            Id = 4711, CarId = 1, ChannelName = "steering", ControlType = "Steering", PinManager = "pca",
            Address = 3, MaxResendInterval = 200, TestDisabled = true, OptionsJson = """{"inverted":true}""",
        };
        var item = ChannelsController.ToMapItem(ch);
        Assert.Equal(4711, item.ServerId);
        Assert.Equal(("Steering", "pca", 3, 200, true), (item.ControlType, item.PinManager, item.Address, item.MaxResendInterval, item.TestDisabled));
        Assert.True(item.Options.ContainsKey("inverted"));
    }
}
