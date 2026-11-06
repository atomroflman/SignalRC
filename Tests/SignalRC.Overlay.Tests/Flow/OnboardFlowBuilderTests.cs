using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Flow;

namespace SignalRC.Overlay.Tests.Flow;

// T06: only the onboard part goes to the vehicle, as one snapshot with a stable hash.
public class OnboardFlowBuilderTests : IDisposable
{
    private readonly SqliteOverlayTestDb _db = new();

    public void Dispose() => _db.Dispose();

    private (int SetupId, Dictionary<string, int> Ids) Seed(bool withOnboard = true)
    {
        using var db = _db.Create();
        var car = new Car { Name = "truck", CarIdentityKey = "of-truck", LastSeen = DateTime.UtcNow };
        var user = new User { Name = "driver", SessionId = 4711, LastSeen = DateTime.UtcNow };
        db.AddRange(car, user);
        db.SaveChanges();
        var steer = new CarChannel { CarId = car.Id, ChannelName = "steer", DisplayName = "Lenkung", MaxResendInterval = 300 };
        var light = new CarChannel { CarId = car.Id, ChannelName = "light" };
        var device = new VehicleInputDevice { CarId = car.Id, DeviceKey = "aa:bb/Pad", Name = "Pad", LastSeenUtc = DateTime.UtcNow };
        device.Channels.Add(new VehicleInputChannel { Code = 0, IsAxis = true, Name = "ABS_X" });
        var setup = new UserCarSetup { CarId = car.Id, UserId = user.Id };
        db.AddRange(steer, light, device, setup);
        db.SaveChanges();

        var browserFn = new UserSetupFunctionNode { UserSetupId = setup.Id, SetupFunctionName = "Reverse" };
        var browserOut = new UserSetupCarChannelNode { UserSetupId = setup.Id, CarChannelId = light.Id };
        db.AddRange(browserFn, browserOut);
        var ids = new Dictionary<string, int>();
        db.SaveChanges();
        ids["browserFn"] = browserFn.Id;
        db.Add(new UserSetupLink { UserSetupFromNodeId = browserFn.Id, UserSetupToNodeId = browserOut.Id });
        if (withOnboard)
        {
            var handoff = new UserSetupHandoffNode { UserSetupId = setup.Id, Zone = FlowZone.Onboard, Name = "Lenkung web" };
            var input = new UserSetupVehicleInputNode { UserSetupId = setup.Id, Zone = FlowZone.Onboard, VehicleInputChannelId = device.Channels.First().Id };
            var priority = new UserSetupFunctionNode { UserSetupId = setup.Id, Zone = FlowZone.Onboard, SetupFunctionName = "Priority" };
            priority.Parameters.Add(new UserSetupFunctionNodeParameter { ParameterName = "x", ParameterValue = "1" });
            var output = new UserSetupCarChannelNode { UserSetupId = setup.Id, Zone = FlowZone.Onboard, CarChannelId = steer.Id };
            db.AddRange(handoff, input, priority, output);
            db.SaveChanges();
            db.AddRange(
                new UserSetupLink { UserSetupFromNodeId = browserFn.Id, UserSetupToNodeId = handoff.Id, TargetPort = "in" },
                new UserSetupLink { UserSetupFromNodeId = input.Id, UserSetupToNodeId = priority.Id, TargetPort = "a" },
                new UserSetupLink { UserSetupFromNodeId = handoff.Id, UserSetupToNodeId = priority.Id, TargetPort = "b" },
                new UserSetupLink { UserSetupFromNodeId = priority.Id, UserSetupToNodeId = output.Id });
            ids["handoff"] = handoff.Id;
            ids["input"] = input.Id;
            ids["priority"] = priority.Id;
            ids["output"] = output.Id;
        }
        db.SaveChanges();
        return (setup.Id, ids);
    }

    [Fact]
    public async Task Builds_only_the_onboard_part()
    {
        var (setupId, ids) = Seed();
        using var db = _db.Create();
        var def = await OnboardFlowBuilder.BuildAsync(db, setupId);
        Assert.NotNull(def);
        Assert.Equal(4, def!.Nodes.Count);
        Assert.DoesNotContain(def.Nodes, n => n.Id == ids["browserFn"]);
        Assert.Equal(3, def.Links.Count); // the browser → handoff link stays in the browser
        var output = def.Nodes.Single(n => n.Kind == OnboardFlowNodeKind.Output);
        Assert.Equal("steer", output.ChannelName);
        Assert.Equal(300, output.ResendIntervalMs);
        var input = def.Nodes.Single(n => n.Kind == OnboardFlowNodeKind.VehicleInput);
        Assert.Equal(("aa:bb/Pad", 0, true), (input.InputDeviceKey, input.InputCode, input.IsAxis));
        Assert.Equal("1", def.Nodes.Single(n => n.Id == ids["priority"]).Params["x"]);
        Assert.Equal(64, def.Hash.Length);
    }

    [Fact]
    public async Task Hash_is_stable_and_follows_changes()
    {
        var (setupId, ids) = Seed();
        string first, second;
        using (var db = _db.Create()) first = (await OnboardFlowBuilder.BuildAsync(db, setupId))!.Hash;
        using (var db = _db.Create()) second = (await OnboardFlowBuilder.BuildAsync(db, setupId))!.Hash;
        Assert.Equal(first, second);
        using (var db = _db.Create())
        {
            db.Add(new UserSetupFunctionNodeParameter { NodeId = ids["priority"], ParameterName = "y", ParameterValue = "2" });
            db.SaveChanges();
            Assert.NotEqual(first, (await OnboardFlowBuilder.BuildAsync(db, setupId))!.Hash);
        }
    }

    [Fact]
    public async Task No_onboard_nodes_means_no_onboard_flow()
    {
        var (setupId, _) = Seed(withOnboard: false);
        using var db = _db.Create();
        Assert.Null(await OnboardFlowBuilder.BuildAsync(db, setupId));
    }
}
