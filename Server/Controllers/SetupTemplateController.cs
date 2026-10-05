using LteCar.Server.Data;
using LteCar.Shared.SetupTemplate;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Controllers;

[ApiController]
[Route("api/setuptemplate")]
public class SetupTemplateController : ControllerBase
{
    public SetupTemplateController(LteCarContext context) : base(context) { }

    [HttpGet("export/{carId:int}")]
    public async Task<IActionResult> Export(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found");

        var channels = await _context.CarChannels.Where(c => c.CarId == carId).ToListAsync();
        var telemetries = await _context.CarTelemetry.Where(t => t.CarId == carId).ToListAsync();
        var streams = await _context.CarVideoStreams.Where(v => v.CarId == carId).ToListAsync();

        var setup = await _context.UserSetups.FirstOrDefaultAsync(s => s.UserId == user.Id && s.CarId == carId);
        var nodes = setup == null
            ? new List<UserSetupFlowNodeBase>()
            : await _context.Set<UserSetupFlowNodeBase>().Where(n => n.UserSetupId == setup.Id).ToListAsync();

        var nodeGuidMap = nodes.ToDictionary(n => n.Id, _ => Guid.NewGuid().ToString());

        var inputChannelIds = nodes.OfType<UserSetupUserChannelNode>().Select(n => n.UserChannelId).Distinct().ToList();
        var inputChannels = inputChannelIds.Any()
            ? await _context.Set<UserChannel>()
                .Include(c => c.UserChannelDevice)
                .Where(c => inputChannelIds.Contains(c.Id))
                .ToDictionaryAsync(c => c.Id)
            : new Dictionary<int, UserChannel>();
        var outputCarChannelIds = nodes.OfType<UserSetupCarChannelNode>().Select(n => n.CarChannelId).Distinct().ToList();
        var outputChannels = outputCarChannelIds.Any()
            ? await _context.CarChannels.Where(c => outputCarChannelIds.Contains(c.Id)).ToDictionaryAsync(c => c.Id)
            : new Dictionary<int, CarChannel>();
        var fnNodes = nodes.OfType<UserSetupFunctionNode>().Select(n => n.Id).ToList();
        var fnParams = fnNodes.Any()
            ? await _context.Set<UserSetupFunctionNodeParameter>()
                .Where(p => fnNodes.Contains(p.NodeId))
                .ToListAsync()
            : new List<UserSetupFunctionNodeParameter>();

        var nodeIdSet = nodes.Select(n => n.Id).ToHashSet();
        var edges = setup == null
            ? new List<UserSetupLink>()
            : await _context.Set<UserSetupLink>()
                .Where(l => nodeIdSet.Contains(l.UserSetupFromNodeId) && nodeIdSet.Contains(l.UserSetupToNodeId))
                .ToListAsync();

        var subs = setup == null
            ? new List<UserSetupTelemetry>()
            : await _context.UserSetupTelemetries.Where(t => t.UserSetupId == setup.Id).ToListAsync();
        var subTelemetryIds = subs.Select(s => s.CarTelemetryId).Distinct().ToList();
        var subTelemetries = subTelemetryIds.Any()
            ? await _context.CarTelemetry.Where(t => subTelemetryIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id)
            : new Dictionary<int, CarTelemetry>();

        var template = new VehicleSetupTemplate
        {
            Name = car.Name,
            ExportedAt = DateTime.UtcNow,
            Channels = new TemplateChannels
            {
                Control = channels.Select(c => new TemplateControlChannel
                {
                    ChannelName = c.ChannelName,
                    DisplayName = c.DisplayName,
                    IsEnabled = c.IsEnabled,
                    RequiresAxis = c.RequiresAxis,
                    MaxResendInterval = c.MaxResendInterval,
                }).ToList(),
                Telemetry = telemetries.Select(t => new TemplateTelemetryChannel
                {
                    ChannelName = t.ChannelName,
                    TelemetryType = t.TelemetryType,
                    DataType = t.DataType.ToString(),
                    Unit = t.Unit,
                    Decimals = t.Decimals,
                    ReadIntervalTicks = t.ReadIntervalTicks,
                }).ToList(),
                Video = streams.Select(s => new TemplateVideoStream
                {
                    StreamId = s.StreamId,
                    Name = s.Name,
                    Type = s.Type,
                    Location = s.Location,
                    Priority = s.Priority,
                    Enabled = s.Enabled,
                    Protocol = s.Protocol.ToString(),
                    Port = s.Port,
                    JanusPort = s.JanusPort,
                    JanusId = s.JanusId,
                    Height = s.Height,
                    Width = s.Width,
                    BitrateKbps = s.Bitrate,
                    Framerate = s.Framerate,
                    Brightness = s.Brightness,
                    ProcessArguments = s.ProcessArguments,
                    StreamPurpose = s.StreamPurpose,
                }).ToList(),
            },
            Flow = new TemplateFlow
            {
                Nodes = nodes.Select(n =>
                {
                    var tn = new TemplateFlowNode
                    {
                        Id = nodeGuidMap[n.Id],
                        PositionX = n.PositionX,
                        PositionY = n.PositionY,
                    };
                    switch (n)
                    {
                        case UserSetupUserChannelNode ic when inputChannels.TryGetValue(ic.UserChannelId, out var uc) && uc.UserChannelDevice != null:
                            tn.Type = "input";
                            tn.Binding = new ControllerBinding
                            {
                                DeviceName = uc.UserChannelDevice.DeviceName,
                                ChannelName = uc.Name ?? (uc.IsAxis ? $"Axis {uc.ChannelId + 1}" : $"Button {uc.ChannelId + 1}"),
                                IsAxis = uc.IsAxis,
                            };
                            break;
                        case UserSetupUserChannelNode:
                            tn.Type = "input";
                            break;
                        case UserSetupCarChannelNode oc when outputChannels.TryGetValue(oc.CarChannelId, out var cc):
                            tn.Type = "output";
                            tn.ChannelName = cc.ChannelName;
                            break;
                        case UserSetupCarChannelNode:
                            tn.Type = "output";
                            break;
                        case UserSetupFunctionNode fn:
                            tn.Type = "function";
                            tn.FunctionName = fn.SetupFunctionName;
                            tn.Parameters = fnParams.Where(p => p.NodeId == fn.Id)
                                .ToDictionary(p => p.ParameterName, p => p.ParameterValue);
                            break;
                    }
                    return tn;
                }).ToList(),
                Edges = edges.Select(e => new TemplateFlowEdge
                {
                    FromNode = nodeGuidMap[e.UserSetupFromNodeId],
                    FromPort = e.SourcePort,
                    ToNode = nodeGuidMap[e.UserSetupToNodeId],
                    ToPort = e.TargetPort,
                }).ToList(),
            },
            TelemetrySubscriptions = subs
                .Where(s => subTelemetries.ContainsKey(s.CarTelemetryId))
                .Select(s => new TemplateTelemetrySubscription
                {
                    ChannelName = subTelemetries[s.CarTelemetryId].ChannelName,
                    Order = s.Order,
                }).ToList(),
        };

        return Ok(template);
    }

    [HttpPost("import/{carId:int}")]
    public async Task<IActionResult> Import(int carId, [FromBody] TemplateImportRequest req)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound("Car not found");

        var template = req.Template;
        var result = new TemplateImportResult();

        var setup = await _context.UserSetups.FirstOrDefaultAsync(s => s.UserId == user.Id && s.CarId == carId);
        if (setup == null)
        {
            setup = new UserCarSetup { UserId = user.Id, CarId = carId };
            _context.UserSetups.Add(setup);
            await _context.SaveChangesAsync();
        }

        var oldNodes = await _context.Set<UserSetupFlowNodeBase>().Where(n => n.UserSetupId == setup.Id).ToListAsync();
        _context.RemoveRange(oldNodes);
        var oldSubs = await _context.UserSetupTelemetries.Where(t => t.UserSetupId == setup.Id).ToListAsync();
        _context.RemoveRange(oldSubs);
        await _context.SaveChangesAsync();

        var targetCarChannels = await _context.CarChannels.Where(c => c.CarId == carId).ToDictionaryAsync(c => c.ChannelName);
        var targetTelemetries = await _context.CarTelemetry.Where(t => t.CarId == carId).ToDictionaryAsync(t => t.ChannelName);
        var filterTypeNames = (await _context.SetupFilterTypes.Select(f => f.TypeName).ToListAsync()).ToHashSet();

        var userChannels = await _context.Set<UserChannel>()
            .Include(c => c.UserChannelDevice)
            .Where(c => c.UserChannelDevice!.UserId == user.Id)
            .ToListAsync();
        var userChannelLookup = userChannels.ToDictionary(
            c => $"{c.UserChannelDevice!.DeviceName}|{c.Name ?? (c.IsAxis ? $"Axis {c.ChannelId + 1}" : $"Button {c.ChannelId + 1}")}|{c.IsAxis}");

        var created = new List<(string TemplateId, UserSetupFlowNodeBase Entity)>();
        foreach (var tnode in template.Flow.Nodes)
        {
            UserSetupFlowNodeBase? entity = null;
            switch ((tnode.Type ?? "").ToLowerInvariant())
            {
                case "input":
                    var binding = tnode.Binding;
                    if (req.ControllerBindings.TryGetValue(tnode.Id, out var ov))
                        binding = ov;
                    if (binding == null || string.IsNullOrEmpty(binding.DeviceName) || string.IsNullOrEmpty(binding.ChannelName))
                    {
                        result.Warnings.Add($"Input node '{tnode.Id}': no controller binding supplied.");
                        continue;
                    }
                    var key = $"{binding.DeviceName}|{binding.ChannelName}|{binding.IsAxis}";
                    if (!userChannelLookup.TryGetValue(key, out var userChannel))
                    {
                        result.Warnings.Add($"Input node '{tnode.Id}': controller '{binding.DeviceName} / {binding.ChannelName}' (axis={binding.IsAxis}) not found for current user.");
                        continue;
                    }
                    entity = new UserSetupUserChannelNode
                    {
                        UserSetupId = setup.Id,
                        UserChannelId = userChannel.Id,
                        PositionX = tnode.PositionX,
                        PositionY = tnode.PositionY,
                    };
                    break;
                case "output":
                    if (string.IsNullOrEmpty(tnode.ChannelName) || !targetCarChannels.TryGetValue(tnode.ChannelName, out var carChannel))
                    {
                        result.Warnings.Add($"Output node '{tnode.Id}': car channel '{tnode.ChannelName}' not found in target vehicle.");
                        continue;
                    }
                    entity = new UserSetupCarChannelNode
                    {
                        UserSetupId = setup.Id,
                        CarChannelId = carChannel.Id,
                        PositionX = tnode.PositionX,
                        PositionY = tnode.PositionY,
                    };
                    break;
                case "function":
                    if (string.IsNullOrEmpty(tnode.FunctionName) || !filterTypeNames.Contains(tnode.FunctionName))
                    {
                        result.Warnings.Add($"Function node '{tnode.Id}': '{tnode.FunctionName}' is not a registered filter type.");
                        continue;
                    }
                    entity = new UserSetupFunctionNode
                    {
                        UserSetupId = setup.Id,
                        SetupFunctionName = tnode.FunctionName,
                        PositionX = tnode.PositionX,
                        PositionY = tnode.PositionY,
                    };
                    break;
                default:
                    result.Warnings.Add($"Node '{tnode.Id}': unknown type '{tnode.Type}'.");
                    continue;
            }
            created.Add((tnode.Id, entity));
        }

        if (created.Count > 0)
            _context.AddRange(created.Select(c => c.Entity));
        await _context.SaveChangesAsync();

        var nodeIdMap = created.ToDictionary(c => c.TemplateId, c => c.Entity.Id);
        result.NodesCreated = created.Count;

        var fnParams = template.Flow.Nodes
            .Where(n => nodeIdMap.ContainsKey(n.Id) && string.Equals(n.Type, "function", StringComparison.OrdinalIgnoreCase))
            .SelectMany(n => (n.Parameters ?? new Dictionary<string, string?>())
                .Select(kv => new UserSetupFunctionNodeParameter
                {
                    NodeId = nodeIdMap[n.Id],
                    ParameterName = kv.Key,
                    ParameterValue = kv.Value,
                }))
            .ToList();
        if (fnParams.Count > 0)
            _context.AddRange(fnParams);

        var edgeEntities = template.Flow.Edges
            .Where(e => nodeIdMap.ContainsKey(e.FromNode) && nodeIdMap.ContainsKey(e.ToNode))
            .Select(e => new UserSetupLink
            {
                UserSetupFromNodeId = nodeIdMap[e.FromNode],
                UserSetupToNodeId = nodeIdMap[e.ToNode],
                SourcePort = e.FromPort,
                TargetPort = e.ToPort,
            })
            .ToList();
        if (edgeEntities.Count > 0)
            _context.AddRange(edgeEntities);
        result.EdgesCreated = edgeEntities.Count;

        var subEntities = new List<UserSetupTelemetry>();
        foreach (var tsub in template.TelemetrySubscriptions)
        {
            if (string.IsNullOrEmpty(tsub.ChannelName) || !targetTelemetries.TryGetValue(tsub.ChannelName, out var telemetry))
            {
                result.Warnings.Add($"Telemetry subscription: channel '{tsub.ChannelName}' not found in target vehicle.");
                continue;
            }
            subEntities.Add(new UserSetupTelemetry
            {
                UserSetupId = setup.Id,
                CarTelemetryId = telemetry.Id,
                Order = tsub.Order,
            });
        }
        if (subEntities.Count > 0)
            _context.UserSetupTelemetries.AddRange(subEntities);
        result.TelemetrySubscribed = subEntities.Count;

        await _context.SaveChangesAsync();
        return Ok(result);
    }
}