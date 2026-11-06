using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Shared.Flow;

namespace SignalRC.Server.Services;

/// <summary>
/// Builds the onboard part of a user's flow as one snapshot (OnboardFlow-Arbeitspakete.md T06):
/// all nodes of the Onboard zone (including handoffs) and the links between them.
/// </summary>
public static class OnboardFlowBuilder
{
    /// <summary>The onboard flow of a setup, or null when the setup has no onboard node (E04).</summary>
    public static async Task<OnboardFlowDefinition?> BuildAsync(SignalRCContext db, int setupId, CancellationToken ct = default)
    {
        var setup = await db.UserSetups.AsNoTracking().FirstOrDefaultAsync(s => s.Id == setupId, ct);
        if (setup == null) return null;

        var nodes = await db.Set<UserSetupFlowNodeBase>().AsNoTracking()
            .Include(n => (n as UserSetupFunctionNode)!.Parameters)
            .Where(n => n.UserSetupId == setupId && n.Zone == FlowZone.Onboard)
            .ToListAsync(ct);
        if (nodes.Count == 0) return null;

        var channelIds = nodes.OfType<UserSetupCarChannelNode>().Select(n => n.CarChannelId).Distinct().ToList();
        var channels = await db.CarChannels.AsNoTracking()
            .Where(c => channelIds.Contains(c.Id) && c.CarId == setup.CarId)
            .ToDictionaryAsync(c => c.Id, ct);
        var inputIds = nodes.OfType<UserSetupVehicleInputNode>().Select(n => n.VehicleInputChannelId).Distinct().ToList();
        var inputs = await db.VehicleInputChannels.AsNoTracking()
            .Include(c => c.VehicleInputDevice)
            .Where(c => inputIds.Contains(c.Id) && c.VehicleInputDevice.CarId == setup.CarId)
            .ToDictionaryAsync(c => c.Id, ct);

        var definition = new OnboardFlowDefinition { SetupId = setup.Id, UserId = setup.UserId };
        foreach (var node in nodes.OrderBy(n => n.Id))
        {
            OnboardFlowNode? item = node switch
            {
                UserSetupFunctionNode fn => new OnboardFlowNode
                {
                    Id = fn.Id,
                    Kind = OnboardFlowNodeKind.Function,
                    Function = fn.SetupFunctionName,
                    Label = fn.SetupFunctionName,
                    Params = fn.Parameters.OrderBy(p => p.ParameterName, StringComparer.Ordinal)
                        .GroupBy(p => p.ParameterName).ToDictionary(g => g.Key, g => g.Last().ParameterValue),
                },
                UserSetupHandoffNode h => new OnboardFlowNode { Id = h.Id, Kind = OnboardFlowNodeKind.Handoff, Label = h.Name },
                UserSetupCarChannelNode c when channels.TryGetValue(c.CarChannelId, out var channel) => new OnboardFlowNode
                {
                    Id = c.Id,
                    Kind = OnboardFlowNodeKind.Output,
                    ChannelName = channel.ChannelName,
                    ResendIntervalMs = channel.MaxResendInterval,
                    Label = channel.DisplayName ?? channel.ChannelName,
                },
                UserSetupVehicleInputNode v when inputs.TryGetValue(v.VehicleInputChannelId, out var input) => new OnboardFlowNode
                {
                    Id = v.Id,
                    Kind = OnboardFlowNodeKind.VehicleInput,
                    InputDeviceKey = input.VehicleInputDevice.DeviceKey,
                    InputCode = input.Code,
                    IsAxis = input.IsAxis,
                    Label = $"{input.VehicleInputDevice.Name}: {input.Name}",
                },
                _ => null,
            };
            if (item != null) definition.Nodes.Add(item);
        }

        var ids = definition.Nodes.Select(n => n.Id).ToHashSet();
        definition.Links = await db.Set<UserSetupLink>().AsNoTracking()
            .Where(l => ids.Contains(l.UserSetupFromNodeId) && ids.Contains(l.UserSetupToNodeId))
            .OrderBy(l => l.Id)
            .Select(l => new OnboardFlowLink { From = l.UserSetupFromNodeId, FromPort = l.SourcePort, To = l.UserSetupToNodeId, ToPort = l.TargetPort })
            .ToListAsync(ct);
        definition.Hash = Hash(definition);
        return definition;
    }

    /// <summary>SHA-256 (hex) over the definition without its hash.</summary>
    public static string Hash(OnboardFlowDefinition definition)
    {
        var copy = new OnboardFlowDefinition { SetupId = definition.SetupId, UserId = definition.UserId, Nodes = definition.Nodes, Links = definition.Links };
        var json = JsonSerializer.Serialize(copy);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(json))).ToLowerInvariant();
    }
}
