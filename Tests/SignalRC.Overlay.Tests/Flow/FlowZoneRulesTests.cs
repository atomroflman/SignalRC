using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Flow;

namespace SignalRC.Overlay.Tests.Flow;

// T03–T05: links only top-down, one zone per channel, zone-bound nodes.
public class FlowZoneRulesTests
{
    private static UserSetupFunctionNode Fn(FlowZone zone, string name = "Abs") => new() { Zone = zone, SetupFunctionName = name };
    private static readonly UserSetupHandoffNode Handoff = new() { Zone = FlowZone.Onboard, Name = "h" };
    private static readonly UserSetupUserChannelNode Gamepad = new() { Zone = FlowZone.Browser };
    private static readonly UserSetupVehicleInputNode Controller = new() { Zone = FlowZone.Onboard };
    private static UserSetupCarChannelNode Out(FlowZone zone, int channel = 1, int id = 0) => new() { Id = id, Zone = zone, CarChannelId = channel };

    public static IEnumerable<object?[]> Links() => new[]
    {
        new object?[] { "gamepad → browser fn", Gamepad, Fn(FlowZone.Browser), true },
        new object?[] { "browser fn → browser out", Fn(FlowZone.Browser), Out(FlowZone.Browser), true },
        new object?[] { "browser fn → handoff", Fn(FlowZone.Browser), Handoff, true },
        new object?[] { "handoff → onboard fn", Handoff, Fn(FlowZone.Onboard), true },
        new object?[] { "handoff → onboard out", Handoff, Out(FlowZone.Onboard), true },
        new object?[] { "controller → onboard fn", Controller, Fn(FlowZone.Onboard), true },
        new object?[] { "onboard fn → onboard out", Fn(FlowZone.Onboard), Out(FlowZone.Onboard), true },
        new object?[] { "browser fn → onboard fn", Fn(FlowZone.Browser), Fn(FlowZone.Onboard), false },
        new object?[] { "gamepad → onboard out", Gamepad, Out(FlowZone.Onboard), false },
        new object?[] { "onboard fn → browser fn", Fn(FlowZone.Onboard), Fn(FlowZone.Browser), false },
        new object?[] { "controller → browser out", Controller, Out(FlowZone.Browser), false },
        new object?[] { "handoff → browser fn", Handoff, Fn(FlowZone.Browser), false },
        new object?[] { "onboard fn → handoff", Fn(FlowZone.Onboard), Handoff, false },
        new object?[] { "handoff → handoff", Handoff, new UserSetupHandoffNode { Zone = FlowZone.Onboard }, false },
        new object?[] { "fn → controller", Fn(FlowZone.Onboard), Controller, false },
        new object?[] { "out → fn", Out(FlowZone.Browser), Fn(FlowZone.Browser), false },
    };

    [Theory]
    [MemberData(nameof(Links))]
    public void Links_run_top_down_only(string name, UserSetupFlowNodeBase from, UserSetupFlowNodeBase to, bool allowed)
    {
        Assert.True(allowed == (FlowZoneRules.CheckLink(from, to) == null), name);
    }

    [Fact]
    public void Zone_bound_nodes()
    {
        Assert.NotNull(FlowZoneRules.ZoneForNewNode(new UserSetupUserChannelNode(), FlowZone.Onboard).Error);
        Assert.Equal(FlowZone.Onboard, FlowZoneRules.ZoneForNewNode(new UserSetupVehicleInputNode(), null).Zone);
        Assert.NotNull(FlowZoneRules.ZoneForNewNode(new UserSetupVehicleInputNode(), FlowZone.Browser).Error);
        Assert.Equal(FlowZone.Onboard, FlowZoneRules.ZoneForNewNode(new UserSetupHandoffNode(), FlowZone.Browser).Zone);
        Assert.NotNull(FlowZoneRules.ZoneForNewNode(Fn(FlowZone.Browser, "HudInput"), FlowZone.Onboard).Error);
        Assert.Null(FlowZoneRules.ZoneForNewNode(Fn(FlowZone.Browser, "Gearbox"), FlowZone.Onboard).Error);
        Assert.Equal(FlowZone.Browser, FlowZoneRules.ZoneForNewNode(Fn(FlowZone.Browser), null).Zone);
        Assert.NotNull(FlowZoneRules.ZoneForNewNode(Fn(FlowZone.Browser, "DisconnectController"), FlowZone.Browser).Error);
        Assert.Null(FlowZoneRules.ZoneForNewNode(Fn(FlowZone.Browser, "DisconnectController"), FlowZone.Onboard).Error);
    }

    [Fact]
    public void A_channel_belongs_to_one_zone()
    {
        var outputs = new[] { Out(FlowZone.Browser, channel: 7, id: 1) };
        Assert.Null(FlowZoneRules.CheckChannelZone(outputs, 7, FlowZone.Browser));
        Assert.NotNull(FlowZoneRules.CheckChannelZone(outputs, 7, FlowZone.Onboard));
        Assert.Null(FlowZoneRules.CheckChannelZone(outputs, 8, FlowZone.Onboard));
        // Moving the only node of the channel is fine.
        Assert.Null(FlowZoneRules.CheckChannelZone(outputs, 7, FlowZone.Onboard, exceptNodeId: 1));
    }

    [Fact]
    public void Cycles_are_detected()
    {
        var links = new[] { (1, 2), (2, 3) };
        Assert.True(FlowZoneRules.CreatesCycle(links, 3, 1));
        Assert.True(FlowZoneRules.CreatesCycle(links, 2, 2));
        Assert.False(FlowZoneRules.CreatesCycle(links, 1, 3));
        Assert.False(FlowZoneRules.CreatesCycle(links, 4, 1));
    }
}
