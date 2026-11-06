using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Overlay.Tests.Overlay;
using SignalRC.Server.Controllers;
using SignalRC.Server.Data;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>
/// Docs/VehicleKeyAuth.md, S6/S8: flows stay per user. Nobody changes another
/// driver's flow, but everyone may list the flows of a vehicle and copy one.
/// </summary>
public sealed class FlowAccessTests : IDisposable
{
    private static readonly Sqids.SqidsEncoder<long> Sqids = new(new Sqids.SqidsOptions { MinLength = 16 });
    private readonly SqliteOverlayTestDb _db = new();
    private readonly SignalRCContext _ctx;
    private readonly ServiceProvider _services;
    private readonly User _alice, _bob;
    private readonly int _car, _aliceSetup, _bobSetup, _aliceA, _aliceB, _aliceLink;

    public FlowAccessTests()
    {
        _ctx = _db.Create();
        var car = new Car { Name = "f", CarIdentityKey = "f", LastSeen = DateTime.UtcNow };
        _alice = new User { Name = "alice", SessionId = 6_000_000_000_001, LastSeen = DateTime.UtcNow };
        _bob = new User { Name = "bob", SessionId = 6_000_000_000_002, LastSeen = DateTime.UtcNow };
        // No SetupFilterType rows: the table is never filled in production either.
        _ctx.AddRange(car, _alice, _bob);
        _ctx.SaveChanges();
        _car = car.Id;
        var aliceSetup = new UserCarSetup { UserId = _alice.Id, CarId = _car };
        var bobSetup = new UserCarSetup { UserId = _bob.Id, CarId = _car };
        _ctx.UserSetups.AddRange(aliceSetup, bobSetup);
        _ctx.SaveChanges();
        (_aliceSetup, _bobSetup) = (aliceSetup.Id, bobSetup.Id);
        var a = new UserSetupFunctionNode { UserSetupId = _aliceSetup, SetupFunctionName = "Invert", PositionX = 1 };
        var b = new UserSetupFunctionNode { UserSetupId = _aliceSetup, SetupFunctionName = "Invert", PositionX = 2 };
        _ctx.AddRange(a, b);
        _ctx.SaveChanges();
        var link = new UserSetupLink { UserSetupFromNodeId = a.Id, UserSetupToNodeId = b.Id };
        _ctx.Add(link);
        _ctx.SaveChanges();
        (_aliceA, _aliceB, _aliceLink) = (a.Id, b.Id, link.Id);
        _services = new ServiceCollection().AddSingleton(Sqids).BuildServiceProvider();
    }

    public void Dispose()
    {
        _services.Dispose();
        _ctx.Dispose();
        _db.Dispose();
    }

    private FlowController As(User user)
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, Sqids.Encode(user.SessionId))], "cookie");
        var http = new DefaultHttpContext { RequestServices = _services, User = new ClaimsPrincipal(identity) };
        return new FlowController(_ctx, NullLogger<FlowController>.Instance) { ControllerContext = new ControllerContext { HttpContext = http } };
    }

    private UserSetupFlowNodeBase Node(int id) => _ctx.Set<UserSetupFlowNodeBase>().AsNoTracking().Single(n => n.Id == id);

    [Fact]
    public async Task NobodyChangesAnotherDriversFlow()
    {
        var bob = As(_bob);
        Assert.IsType<NotFoundResult>(await bob.MoveNode(new FlowController.MoveNodeRequest { NodeId = _aliceA, PositionX = 99 }));
        Assert.IsType<NotFoundObjectResult>(await bob.MoveNodes([new FlowController.MoveNodeRequest { NodeId = _aliceA, PositionX = 99 }]));
        Assert.IsType<NotFoundResult>(await bob.SetFunctionNodeParams(_aliceA, new() { ["x"] = "1" }));
        Assert.IsType<NotFoundResult>(await bob.UnlinkNode(_aliceLink));
        Assert.IsType<NotFoundObjectResult>(await bob.LinkNode(new FlowController.LinkNodeRequest { FromNodeId = _aliceB, ToNodeId = _aliceA }));
        Assert.IsType<NotFoundObjectResult>(await bob.AddNode("function", null, new FlowController.AddNodeRequest { UserSetupId = _aliceSetup, SetupFunctionName = "Invert" }));
        Assert.IsType<NotFoundResult>(await bob.DeleteNode(_aliceA));

        Assert.Equal(1, Node(_aliceA).PositionX);
        Assert.True(_ctx.Set<UserSetupLink>().Any(l => l.Id == _aliceLink));

        // The owner may.
        Assert.IsType<OkResult>(await As(_alice).MoveNode(new FlowController.MoveNodeRequest { NodeId = _aliceA, PositionX = 5 }));
        Assert.Equal(5, Node(_aliceA).PositionX);
    }

    [Fact]
    public async Task EveryoneSeesTheFlowsOfAVehicle()
    {
        var list = (List<FlowController.SetupSummary>)Assert.IsType<OkObjectResult>(await As(_bob).ListSetups(_car)).Value!;
        // Bob's empty flow is listed as his own, Alice's with its size.
        var alice = Assert.Single(list, s => s.SetupId == _aliceSetup);
        Assert.Equal(("alice", false, 2, 1), (alice.Owner, alice.IsMine, alice.NodeCount, alice.LinkCount));
        Assert.True(Assert.Single(list, s => s.SetupId == _bobSetup).IsMine);
    }

    [Fact]
    public async Task CopyingReplacesOnlyTheCallersOwnFlow()
    {
        var result = await As(_bob).CopyFrom(_car, _aliceSetup);
        Assert.IsType<OkObjectResult>(result);
        var bobNodes = _ctx.Set<UserSetupFlowNodeBase>().AsNoTracking().Where(n => n.UserSetupId == _bobSetup).ToList();
        Assert.Equal(2, bobNodes.Count);
        var bobIds = bobNodes.Select(n => n.Id).ToList();
        Assert.Single(_ctx.Set<UserSetupLink>().Where(l => bobIds.Contains(l.UserSetupToNodeId)));
        // Alice's flow is untouched.
        Assert.Equal(2, _ctx.Set<UserSetupFlowNodeBase>().Count(n => n.UserSetupId == _aliceSetup));

        // Copying the own flow or a flow of another vehicle is refused.
        Assert.IsType<BadRequestObjectResult>(await As(_alice).CopyFrom(_car, _aliceSetup));
        Assert.IsType<NotFoundObjectResult>(await As(_bob).CopyFrom(_car + 1000, _aliceSetup));
    }

    [Fact]
    public async Task CopyingKeepsInputsFunctionsParametersAndLinks()
    {
        // Alice and Bob drive with differently named gamepads.
        var car = new Car { Name = "g", CarIdentityKey = "g", LastSeen = DateTime.UtcNow };
        var alicePad = new UserChannelDevice { DeviceName = "Xbox Controller (alice)", UserId = _alice.Id };
        var bobPad = new UserChannelDevice { DeviceName = "8BitDo Pro 2", UserId = _bob.Id };
        var aliceAxis = new UserChannel { UserChannelDevice = alicePad, ChannelId = 2, IsAxis = true };
        var bobAxis = new UserChannel { UserChannelDevice = bobPad, ChannelId = 2, IsAxis = true };
        var bobOther = new UserChannel { UserChannelDevice = bobPad, ChannelId = 0, IsAxis = true };
        _ctx.AddRange(car, alicePad, bobPad, aliceAxis, bobAxis, bobOther);
        _ctx.SaveChanges();
        var steering = new CarChannel { CarId = car.Id, ChannelName = "steering" };
        var setup = new UserCarSetup { UserId = _alice.Id, CarId = car.Id };
        _ctx.AddRange(steering, setup);
        _ctx.SaveChanges();
        var input = new UserSetupUserChannelNode { UserSetupId = setup.Id, UserChannelId = aliceAxis.Id };
        var fn = new UserSetupFunctionNode { UserSetupId = setup.Id, SetupFunctionName = "Expo" };
        var output = new UserSetupCarChannelNode { UserSetupId = setup.Id, CarChannelId = steering.Id };
        _ctx.AddRange(input, fn, output);
        _ctx.SaveChanges();
        _ctx.AddRange(
            new UserSetupFunctionNodeParameter { NodeId = fn.Id, ParameterName = "factor", ParameterValue = "0.4" },
            new UserSetupLink { UserSetupFromNodeId = input.Id, UserSetupToNodeId = fn.Id },
            new UserSetupLink { UserSetupFromNodeId = fn.Id, UserSetupToNodeId = output.Id });
        _ctx.SaveChanges();

        Assert.IsType<OkObjectResult>(await As(_bob).CopyFrom(car.Id, setup.Id));

        var bobSetup = _ctx.UserSetups.AsNoTracking().Single(s => s.UserId == _bob.Id && s.CarId == car.Id);
        var nodes = _ctx.Set<UserSetupFlowNodeBase>().AsNoTracking().Where(n => n.UserSetupId == bobSetup.Id).ToList();
        Assert.Equal(3, nodes.Count);
        // The input lands on the same axis of Bob's own gamepad.
        Assert.Equal(bobAxis.Id, Assert.Single(nodes.OfType<UserSetupUserChannelNode>()).UserChannelId);
        var bobFn = Assert.Single(nodes.OfType<UserSetupFunctionNode>());
        Assert.Equal("Expo", bobFn.SetupFunctionName);
        var param = Assert.Single(_ctx.Set<UserSetupFunctionNodeParameter>().AsNoTracking().Where(p => p.NodeId == bobFn.Id));
        Assert.Equal(("factor", "0.4"), (param.ParameterName, param.ParameterValue));
        var ids = nodes.Select(n => n.Id).ToList();
        Assert.Equal(2, _ctx.Set<UserSetupLink>().Count(l => ids.Contains(l.UserSetupToNodeId)));
    }
}
