using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Flow;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace SignalRC.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public partial class FlowController : ControllerBase
{
    private readonly ILogger<FlowController> _logger;

    public FlowController(SignalRCContext context, ILogger<FlowController> logger) : base(context)
    {
        _logger = logger;
    }

    [HttpGet("{userSetupId}")]
    public async Task<IActionResult> GetFlow(int userSetupId)
    {
        var flowNodes = await _context.Set<UserSetupFlowNodeBase>()
            .Include(n => (n as UserSetupFunctionNode)!.Parameters)
            .Where(n => n.UserSetupId == userSetupId)
            .ToListAsync();
        if (flowNodes == null || !flowNodes.Any())
        {
            return Ok(new
            {
                nodes = new List<object>(),
                links = new List<object>()
            });
        }

        var loadedNodes = flowNodes.Select(n => n.Id).ToList();

        return Ok(new
        {
            nodes = flowNodes.Select(fn => FlowNodeToNodeInfo(fn)),
            edges = await _context.Set<UserSetupLink>()
                .Where(l => loadedNodes.Contains(l.UserSetupFromNodeId) && loadedNodes.Contains(l.UserSetupToNodeId))
                .Select(l => new
                {
                    id = l.Id,
                    source = l.UserSetupFromNodeId,
                    sourcePort = l.SourcePort,
                    target = l.UserSetupToNodeId,
                    targetPort = l.TargetPort,
                })
                .ToListAsync()
        });
    }

    // -- Flows of other drivers (Docs/VehicleKeyAuth.md: flows stay per user, but every
    //    driver may look at the others' flows of a vehicle and copy one into their own) --

    public sealed record SetupSummary(int SetupId, string Owner, bool IsMine, int NodeCount, int LinkCount);

    [Security.AllowWithoutVehicleSession]
    [HttpGet("cars/{carId:int}/setups")]
    public async Task<IActionResult> ListSetups(int carId)
    {
        var user = await GetCurrentUserAsync();
        var setups = await _context.UserSetups.AsNoTracking().Where(s => s.CarId == carId)
            .Select(s => new { s.Id, s.UserId }).ToListAsync();
        var setupIds = setups.Select(s => s.Id).ToList();
        var nodes = await _context.Set<UserSetupFlowNodeBase>().AsNoTracking()
            .Where(n => setupIds.Contains(n.UserSetupId))
            .Select(n => new { n.Id, n.UserSetupId }).ToListAsync();
        var nodeSetup = nodes.ToDictionary(n => n.Id, n => n.UserSetupId);
        var nodeIds = nodeSetup.Keys.ToList();
        var links = await _context.Set<UserSetupLink>().AsNoTracking()
            .Where(l => nodeIds.Contains(l.UserSetupToNodeId))
            .Select(l => l.UserSetupToNodeId).ToListAsync();
        var userIds = setups.Select(s => s.UserId).Distinct().ToList();
        var names = await _context.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id, u => u.LoginName ?? u.Name ?? $"User {u.Id}");

        var result = setups
            .Select(s => new SetupSummary(
                s.Id,
                names.GetValueOrDefault(s.UserId) ?? $"User {s.UserId}",
                user != null && s.UserId == user.Id,
                nodes.Count(n => n.UserSetupId == s.Id),
                links.Count(to => nodeSetup[to] == s.Id)))
            .Where(s => s.IsMine || s.NodeCount > 0)
            .OrderByDescending(s => s.IsMine).ThenBy(s => s.Owner)
            .ToList();
        return Ok(result);
    }

    /// <summary>Replaces the caller's flow for the vehicle with a copy of another driver's flow.</summary>
    [Security.AllowWithoutVehicleSession]
    [HttpPost("cars/{carId:int}/copy-from/{setupId:int}")]
    public async Task<IActionResult> CopyFrom(int carId, int setupId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var source = await _context.UserSetups.AsNoTracking().FirstOrDefaultAsync(s => s.Id == setupId && s.CarId == carId);
        if (source == null) return NotFound("Flow not found");
        if (source.UserId == user.Id) return BadRequest("This is your own flow.");
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found");

        // Through the template: gamepad inputs are matched by device and channel name,
        // since the other driver's gamepads are not the caller's.
        var templates = new SetupTemplateController(_context);
        var template = await templates.BuildTemplateAsync(car, source);
        var result = await templates.ApplyTemplateAsync(user, carId, template);
        _logger.LogInformation("User {UserId} copied flow {SetupId} of car {CarId}", user.Id, setupId, carId);
        HttpContext?.RequestServices.GetService<OnboardFlowPublisher>()?.FlowChanged(carId, user.Id);
        return Ok(result);
    }

    [HttpPost("{nodetype}/{id?}")]
    public async Task<IActionResult> AddNode(string nodetype, int? id, [FromBody] AddNodeRequest req)
    {
        _logger.LogDebug("AddNode: nodetype={Nodetype}, id={Id}, userSetupId={UserSetupId}", nodetype, id, req.UserSetupId);
        var user = await GetCurrentUserAsync();
        if (user == null)
            return Unauthorized("User not found");
        // Only into the caller's own flow (Docs/VehicleKeyAuth.md: flows stay per user).
        if (!await OwnSetupIds(user.Id).AnyAsync(id => id == req.UserSetupId))
            return NotFound("UserSetup not found");
        UserSetupFlowNodeBase node;
        switch (nodetype.ToLowerInvariant())
        {
            case "input":
                var channel = await _context.Set<UserChannel>()
                    .FirstOrDefaultAsync(c => c.UserChannelDevice.UserId == user.Id && c.Id == id);
                if (channel == null)
                {
                    _logger.LogWarning("AddNode: UserChannel not found for userId={UserId}, channelId={ChannelId}", user.Id, id);
                    return NotFound("UserChannel not found");
                }

                node = new UserSetupUserChannelNode
                {
                    UserSetupId = req.UserSetupId,
                    UserChannelId = channel.Id,
                    PositionX = req.PositionX,
                    PositionY = req.PositionY
                };
                break;
            case "output":
                var setup = await _context.Set<UserCarSetup>()
                    .FirstOrDefaultAsync(s => s.Id == req.UserSetupId && s.UserId == user.Id);
                if (setup == null)
                {
                    _logger.LogWarning("AddNode: UserCarSetup not found for userId={UserId}, userSetupId={UserSetupId}", user.Id, req.UserSetupId);
                    return NotFound("UserSetup not found");
                }
                var carChannel = await _context.Set<CarChannel>()
                    .FirstOrDefaultAsync(c => c.Id == id && c.CarId == setup.CarId);
                if (carChannel == null)
                {
                    _logger.LogWarning("AddNode: CarChannel not found for channelId={ChannelId}, carId={CarId}", id, setup.CarId);
                    return NotFound("CarChannel not found");
                }
                node = new UserSetupCarChannelNode
                {
                    UserSetupId = req.UserSetupId,
                    CarChannelId = carChannel.Id,
                    PositionX = req.PositionX,
                    PositionY = req.PositionY
                };
                break;
            case "function":
                node = new UserSetupFunctionNode
                {
                    UserSetupId = req.UserSetupId,
                    SetupFunctionName = req.SetupFunctionName ?? "undefined",
                    PositionX = req.PositionX,
                    PositionY = req.PositionY
                };
                break;
            case "handoff":
                node = new UserSetupHandoffNode
                {
                    UserSetupId = req.UserSetupId,
                    Name = string.IsNullOrWhiteSpace(req.Name) ? "Übergabe" : req.Name.Trim()[..Math.Min(64, req.Name.Trim().Length)],
                    PositionX = req.PositionX,
                    PositionY = req.PositionY
                };
                break;
            case "vehicleinput":
                var inputSetup = await _context.UserSetups.AsNoTracking().FirstOrDefaultAsync(s => s.Id == req.UserSetupId);
                // Controllers belong to the vehicle (E14): any driver of the car may use them.
                var inputChannel = inputSetup == null ? null : await _context.VehicleInputChannels
                    .FirstOrDefaultAsync(c => c.Id == id && c.VehicleInputDevice.CarId == inputSetup.CarId);
                if (inputChannel == null)
                    return NotFound("Vehicle controller channel not found");
                node = new UserSetupVehicleInputNode
                {
                    UserSetupId = req.UserSetupId,
                    VehicleInputChannelId = inputChannel.Id,
                    PositionX = req.PositionX,
                    PositionY = req.PositionY
                };
                break;
            default:
                return BadRequest("Unknown node type");
        }
        var (zone, zoneError) = FlowZoneRules.ZoneForNewNode(node, req.Zone);
        if (zoneError != null)
            return BadRequest(zoneError);
        node.Zone = zone;
        if (node is UserSetupCarChannelNode newOutput)
        {
            var outputs = await _context.Set<UserSetupCarChannelNode>().Where(n => n.UserSetupId == req.UserSetupId).ToListAsync();
            var channelError = FlowZoneRules.CheckChannelZone(outputs, newOutput.CarChannelId, zone);
            if (channelError != null)
                return BadRequest(channelError);
        }
        _context.Add(node);
        await _context.SaveChangesAsync();
        await NotifyFlowChangedAsync(node.UserSetupId);
        return Ok(FlowNodeToNodeInfo(node));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteNode(int id)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var node = await OwnNodes(user.Id).FirstOrDefaultAsync(n => n.Id == id);
        if (node == null)
            return NotFound();

        var links = _context.Set<UserSetupLink>().Where(e => e.UserSetupFromNodeId == id || e.UserSetupToNodeId == id);
        _context.RemoveRange(links);
        _context.Remove(node);
        await _context.SaveChangesAsync();
        await NotifyFlowChangedAsync(node.UserSetupId);
        return Ok();
    }

    // The UserSetup navigation is not mapped; a user's flow is the nodes of their setups.
    private IQueryable<int> OwnSetupIds(int userId) =>
        _context.UserSetups.Where(s => s.UserId == userId).Select(s => s.Id);

    private IQueryable<UserSetupFlowNodeBase> OwnNodes(int userId)
    {
        var setupIds = OwnSetupIds(userId);
        return _context.Set<UserSetupFlowNodeBase>().Where(n => setupIds.Contains(n.UserSetupId));
    }

    /// <summary>The flow of a setup changed: its onboard part goes to the vehicle again if the owner drives it (E09).</summary>
    private async Task NotifyFlowChangedAsync(int setupId)
    {
        var setup = await _context.UserSetups.AsNoTracking().Where(s => s.Id == setupId)
            .Select(s => new { s.CarId, s.UserId }).FirstOrDefaultAsync();
        if (setup == null) return;
        HttpContext?.RequestServices.GetService<OnboardFlowPublisher>()?.FlowChanged(setup.CarId, setup.UserId);
    }

    private NodeInfo? FlowNodeToNodeInfo(UserSetupFlowNodeBase flowNode)
    {
        var result = new NodeInfo
        {
            NodeId = flowNode.Id,
            Position = new NodePosition
            {
                X = flowNode.PositionX,
                Y = flowNode.PositionY,
            },
            NodeTypeName = flowNode.GetType().Name,
            Type = "default",
            Zone = FlowZoneRules.ZoneName(flowNode.Zone),
        };
        switch (flowNode)
        {
            case UserSetupUserChannelNode userChannel:
                result.RepresentingId = userChannel.UserChannelId;
                result.Type = "input";
                var channel = _context.Set<UserChannel>().FirstOrDefault(uc => uc.Id == userChannel.UserChannelId);
                if (channel == null)
                    return result;
                result.Label = channel.Name ?? $"{(channel.IsAxis ? "axis" : "button")}-{channel.ChannelId}";
                break;
            case UserSetupCarChannelNode carChannel:
                var output = _context.CarChannels.FirstOrDefault(cc => cc.Id == carChannel.CarChannelId);
                if (output == null)
                    return result;
                result.Label = output.DisplayName ?? output.ChannelName;
                result.RepresentingId = carChannel.CarChannelId;
                result.MaxResendInterval = output.MaxResendInterval;
                result.Type = "output";
                break;
            case UserSetupHandoffNode handoff:
                result.Type = "handoff";
                result.Label = handoff.Name;
                break;
            case UserSetupVehicleInputNode vehicleInput:
                // Own type: its id is a VehicleInputChannel id, not a UserChannel id like "input".
                result.Type = "vehicleInput";
                result.RepresentingId = vehicleInput.VehicleInputChannelId;
                var vehicleChannel = _context.VehicleInputChannels.Include(c => c.VehicleInputDevice)
                    .FirstOrDefault(c => c.Id == vehicleInput.VehicleInputChannelId);
                result.Label = vehicleChannel == null ? "?" : $"{vehicleChannel.VehicleInputDevice.Name}: {vehicleChannel.Name}";
                break;
            case UserSetupFunctionNode fn:
                result.Label = fn.SetupFunctionName;
                result.Metadata = new
                {
                    functionName = fn.SetupFunctionName
                };                
                result.Params = fn.Parameters
                    .ToDictionary(p => p.ParameterName, p => p.ParameterValue);
                break;
            default:
                return null;
        }
        return result;
    }

    public sealed record SetZoneRequest(FlowZone Zone);

    /// <summary>Moves a function or output node into the other zone; refused if a connection or the channel rule would break.</summary>
    [HttpPost("{nodeId:int}/zone")]
    public async Task<IActionResult> SetZone(int nodeId, [FromBody] SetZoneRequest req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var node = await OwnNodes(user.Id).FirstOrDefaultAsync(n => n.Id == nodeId);
        if (node == null) return NotFound();
        if (node is not (UserSetupFunctionNode or UserSetupCarChannelNode))
            return BadRequest("Only functions and vehicle channels can change their zone.");
        if (node.Zone == req.Zone) return Ok(FlowNodeToNodeInfo(node));
        var (_, zoneError) = FlowZoneRules.ZoneForNewNode(node, req.Zone);
        if (zoneError != null) return BadRequest(zoneError);
        var setupNodes = await _context.Set<UserSetupFlowNodeBase>().Where(n => n.UserSetupId == node.UserSetupId).ToDictionaryAsync(n => n.Id);
        var links = await _context.Set<UserSetupLink>()
            .Where(l => l.UserSetupFromNodeId == nodeId || l.UserSetupToNodeId == nodeId).ToListAsync();
        var previous = node.Zone;
        node.Zone = req.Zone;
        foreach (var link in links)
        {
            if (!setupNodes.TryGetValue(link.UserSetupFromNodeId, out var f) || !setupNodes.TryGetValue(link.UserSetupToNodeId, out var t)) continue;
            var error = FlowZoneRules.CheckLink(f, t);
            if (error != null)
            {
                node.Zone = previous;
                return BadRequest($"Remove the connections first: {error}");
            }
        }
        if (node is UserSetupCarChannelNode output)
        {
            var channelError = FlowZoneRules.CheckChannelZone(setupNodes.Values.OfType<UserSetupCarChannelNode>(), output.CarChannelId, req.Zone, output.Id);
            if (channelError != null)
            {
                node.Zone = previous;
                return BadRequest(channelError);
            }
        }
        await _context.SaveChangesAsync();
        await NotifyFlowChangedAsync(node.UserSetupId);
        return Ok(FlowNodeToNodeInfo(node));
    }

    public sealed record RenameRequest(string Name);

    [HttpPost("{nodeId:int}/name")]
    public async Task<IActionResult> RenameHandoff(int nodeId, [FromBody] RenameRequest req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var node = await OwnNodes(user.Id).OfType<UserSetupHandoffNode>().FirstOrDefaultAsync(n => n.Id == nodeId);
        if (node == null) return NotFound();
        var name = (req.Name ?? string.Empty).Trim();
        node.Name = name.Length == 0 ? "Übergabe" : name[..Math.Min(64, name.Length)];
        await _context.SaveChangesAsync();
        return Ok(FlowNodeToNodeInfo(node));
    }

    public sealed record VehicleInputChannelView(int Id, int Code, bool IsAxis, string Name);
    public sealed record VehicleInputDeviceView(int Id, string Key, string Name, DateTime LastSeenUtc, List<VehicleInputChannelView> Channels);

    /// <summary>Controllers the vehicle has reported, with their channels (E14: for every driver of the car).</summary>
    [Security.AllowWithoutVehicleSession]
    [HttpGet("cars/{carId:int}/vehicle-inputs")]
    public async Task<IActionResult> VehicleInputs(int carId)
    {
        var devices = await _context.VehicleInputDevices.AsNoTracking().Include(d => d.Channels)
            .Where(d => d.CarId == carId).OrderBy(d => d.Name).ToListAsync();
        return Ok(devices.Select(d => new VehicleInputDeviceView(d.Id, d.DeviceKey, d.Name, d.LastSeenUtc,
            d.Channels.OrderByDescending(c => c.IsAxis).ThenBy(c => c.Code).Select(c => new VehicleInputChannelView(c.Id, c.Code, c.IsAxis, c.Name)).ToList())));
    }

    [HttpPost("movenode")]
    public async Task<IActionResult> MoveNode([FromBody] MoveNodeRequest req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var node = await OwnNodes(user.Id).FirstOrDefaultAsync(n => n.Id == req.NodeId);
        if (node == null) return NotFound();
        node.PositionX = req.PositionX;
        node.PositionY = req.PositionY;
        await _context.SaveChangesAsync();
        return Ok();
    }

    // Auto layout: all positions in one request; only nodes of the user's own setups.
    [HttpPost("movenodes")]
    public async Task<IActionResult> MoveNodes([FromBody] List<MoveNodeRequest> req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
            return Unauthorized("User not found");
        var ids = req.Select(r => r.NodeId).Distinct().ToList();
        // The UserSetup navigation is not mapped; match the user's setups by id.
        var nodes = await OwnNodes(user.Id)
            .Where(n => ids.Contains(n.Id))
            .ToListAsync();
        if (nodes.Count != ids.Count)
            return NotFound("Node(s) not found");
        foreach (var r in req)
        {
            var node = nodes.First(n => n.Id == r.NodeId);
            node.PositionX = r.PositionX;
            node.PositionY = r.PositionY;
        }
        await _context.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("link")]
    public async Task<IActionResult> LinkNode([FromBody] LinkNodeRequest req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var from = await OwnNodes(user.Id).FirstOrDefaultAsync(n => n.Id == req.FromNodeId);
        var to = await OwnNodes(user.Id).FirstOrDefaultAsync(n => n.Id == req.ToNodeId);
        if (from == null || to == null || from.UserSetupId != to.UserSetupId)
            return NotFound("Node(s) not found");

        var linkError = FlowZoneRules.CheckLink(from, to);
        if (linkError != null)
            return BadRequest(linkError);
        if (to.Zone == FlowZone.Onboard && to is not UserSetupHandoffNode)
        {
            // The onboard engine runs in topological order: no cycles there (T03).
            var setupNodeIds = OwnNodes(user.Id).Where(n => n.UserSetupId == from.UserSetupId).Select(n => n.Id);
            var existing = await _context.Set<UserSetupLink>()
                .Where(l => setupNodeIds.Contains(l.UserSetupFromNodeId) && !(l.UserSetupToNodeId == req.ToNodeId && l.TargetPort == req.ToPort))
                .Select(l => new { l.UserSetupFromNodeId, l.UserSetupToNodeId }).ToListAsync();
            if (FlowZoneRules.CreatesCycle(existing.Select(l => (l.UserSetupFromNodeId, l.UserSetupToNodeId)), req.FromNodeId, req.ToNodeId))
                return BadRequest("This connection would close a loop; the onboard flow must not contain loops.");
        }

        // only 1 incoming link allowed per port
        var otherToLink = await _context.Set<UserSetupLink>()
            .FirstOrDefaultAsync(l => l.UserSetupToNodeId == req.ToNodeId && l.TargetPort == req.ToPort);
        if (otherToLink != null)
        {
            if (otherToLink.UserSetupFromNodeId == req.FromNodeId && otherToLink.SourcePort == req.FromPort)
                return Ok(new { id = otherToLink.Id, source = otherToLink.UserSetupFromNodeId, sourcePort = otherToLink.SourcePort, target = otherToLink.UserSetupToNodeId, targetPort = otherToLink.TargetPort }); // already linked
            _context.Remove(otherToLink); // remove existing link
        }

        var link = new UserSetupLink
        {
            UserSetupFromNodeId = req.FromNodeId,
            SourcePort = req.FromPort,
            UserSetupToNodeId = req.ToNodeId,
            TargetPort = req.ToPort
        };
        _context.Add(link);
        await _context.SaveChangesAsync();
        await NotifyFlowChangedAsync(from.UserSetupId);
        return Ok(new { id = link.Id, source = link.UserSetupFromNodeId, sourcePort = link.SourcePort, target = link.UserSetupToNodeId, targetPort = link.TargetPort });
    }

    [HttpDelete("unlink/{id}")]
    public async Task<IActionResult> UnlinkNode(int id)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var ownNodeIds = OwnNodes(user.Id).Select(n => n.Id);
        var link = await _context.Set<UserSetupLink>()
            .FirstOrDefaultAsync(l => l.Id == id && ownNodeIds.Contains(l.UserSetupToNodeId));
        if (link == null) return NotFound();
        _context.Remove(link);
        await _context.SaveChangesAsync();
        var setupId = await _context.Set<UserSetupFlowNodeBase>().Where(n => n.Id == link.UserSetupToNodeId).Select(n => n.UserSetupId).FirstOrDefaultAsync();
        await NotifyFlowChangedAsync(setupId);
        return Ok();
    }

    [HttpPost("{nodeId}/params")]
    public async Task<IActionResult> SetFunctionNodeParams(int nodeId, [FromBody] Dictionary<string, string?> paramDict)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized("User not found");
        var ownSetups = OwnSetupIds(user.Id);
        var node = await _context.Set<UserSetupFunctionNode>().FirstOrDefaultAsync(n => n.Id == nodeId && ownSetups.Contains(n.UserSetupId));
        if (node == null)
            return NotFound();
        var existingParams = await _context.Set<UserSetupFunctionNodeParameter>()
            .Where(p => p.NodeId == nodeId)
            .ToListAsync();
        foreach (var kv in paramDict)
        {
            var existing = existingParams.FirstOrDefault(p => p.ParameterName == kv.Key);
            if (existing != null)
            {
                existing.ParameterValue = kv.Value;
            }
            else
            {
                _context.Add(new UserSetupFunctionNodeParameter
                {
                    NodeId = nodeId,
                    ParameterName = kv.Key,
                    ParameterValue = kv.Value ?? string.Empty
                });
            }
        }
        await _context.SaveChangesAsync();
        await NotifyFlowChangedAsync(node.UserSetupId);
        return Ok();
    }
}

