using LteCar.Server.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public partial class FlowController : ControllerBase
{
    private readonly ILogger<FlowController> _logger;

    public FlowController(LteCarContext context, ILogger<FlowController> logger) : base(context)
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

    [HttpPost("{nodetype}/{id?}")]
    public async Task<IActionResult> AddNode(string nodetype, int? id, [FromBody] AddNodeRequest req)
    {
        _logger.LogDebug("AddNode: nodetype={Nodetype}, id={Id}, userSetupId={UserSetupId}", nodetype, id, req.UserSetupId);
        var user = await GetCurrentUserAsync();
        if (user == null)
            return Unauthorized("User not found");
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
            default:
                return BadRequest("Unknown node type");
        }
        _context.Add(node);
        await _context.SaveChangesAsync();
        return Ok(FlowNodeToNodeInfo(node));
    }

    [HttpDelete("{id}")]
    public async Task<IActionResult> DeleteNode(int id)
    {
        var node = await _context.Set<UserSetupFlowNodeBase>().FirstOrDefaultAsync(n => n.Id == id);
        if (node == null)
            return NotFound();

        var links = _context.Set<UserSetupLink>().Where(e => e.UserSetupFromNodeId == id || e.UserSetupToNodeId == id);
        _context.RemoveRange(links);
        _context.Remove(node);
        await _context.SaveChangesAsync();
        return Ok();
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
            Type = "default"
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

    [HttpPost("movenode")]
    public async Task<IActionResult> MoveNode([FromBody] MoveNodeRequest req)
    {
        var node = await _context.Set<UserSetupFlowNodeBase>().FirstOrDefaultAsync(n => n.Id == req.NodeId);
        if (node == null) return NotFound();
        node.PositionX = req.PositionX;
        node.PositionY = req.PositionY;
        await _context.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("link")]
    public async Task<IActionResult> LinkNode([FromBody] LinkNodeRequest req)
    {
        var from = await _context.Set<UserSetupFlowNodeBase>().FirstOrDefaultAsync(n => n.Id == req.FromNodeId);
        var to = await _context.Set<UserSetupFlowNodeBase>().FirstOrDefaultAsync(n => n.Id == req.ToNodeId);
        if (from == null || to == null)
            return NotFound("Node(s) not found");

        if (to is UserSetupUserChannelNode)
            return BadRequest("Cannot link to UserChannelNode");

        if (from is UserSetupCarChannelNode)
            return BadRequest("Cannot link from UserChannelNode");

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
        return Ok(new { id = link.Id, source = link.UserSetupFromNodeId, sourcePort = link.SourcePort, target = link.UserSetupToNodeId, targetPort = link.TargetPort });
    }

    [HttpDelete("unlink/{id}")]
    public async Task<IActionResult> UnlinkNode(int id)
    {
        var link = await _context.Set<UserSetupLink>()
            .FirstOrDefaultAsync(l => l.Id == id);
        if (link == null) return NotFound();
        _context.Remove(link);
        await _context.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("{nodeId}/params")]
    public async Task<IActionResult> SetFunctionNodeParams(int nodeId, [FromBody] Dictionary<string, string?> paramDict)
    {
        var node = await _context.Set<UserSetupFunctionNode>().FirstOrDefaultAsync(n => n.Id == nodeId);
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
        return Ok();
    }
}

