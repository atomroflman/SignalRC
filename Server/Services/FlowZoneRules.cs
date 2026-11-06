using SignalRC.Server.Data;
using SignalRC.Shared.Flow;

namespace SignalRC.Server.Services;

/// <summary>
/// The rules that keep browser and onboard flow apart (OnboardFlow-Arbeitspakete.md T03–T05):
/// links only run top-down (browser → browser, browser → handoff, handoff → onboard,
/// onboard → onboard), the onboard zone has no cycles, a control channel is driven from
/// one zone only, and some nodes only exist in one zone.
/// </summary>
public static class FlowZoneRules
{
    /// <summary>Functions that only make sense in the browser (HUD clicks and HUD display).</summary>
    public static readonly IReadOnlySet<string> BrowserOnlyFunctions = new HashSet<string>(StringComparer.Ordinal) { "HudInput", "HudSignal" };

    /// <summary>Functions that only exist in the vehicle flow (they act on the vehicle).</summary>
    public static readonly IReadOnlySet<string> OnboardOnlyFunctions = new HashSet<string>(StringComparer.Ordinal) { "DisconnectController", "TelemetryOut" };

    private enum Side { Browser, Handoff, Onboard }

    private static Side SideOf(UserSetupFlowNodeBase node) => node switch
    {
        UserSetupHandoffNode => Side.Handoff,
        _ when node.Zone == FlowZone.Onboard => Side.Onboard,
        _ => Side.Browser,
    };

    /// <summary>The zone a new node gets, or an error if the requested zone is not allowed for it.</summary>
    public static (FlowZone Zone, string? Error) ZoneForNewNode(UserSetupFlowNodeBase node, FlowZone? requested)
    {
        switch (node)
        {
            case UserSetupUserChannelNode:
                return requested is FlowZone.Onboard ? (FlowZone.Browser, "Browser gamepads only exist in the browser flow.") : (FlowZone.Browser, null);
            case UserSetupVehicleInputNode:
                return requested is FlowZone.Browser ? (FlowZone.Onboard, "Vehicle controllers only exist in the onboard flow.") : (FlowZone.Onboard, null);
            case UserSetupHandoffNode:
                return (FlowZone.Onboard, null);
            case UserSetupFunctionNode fn when requested == FlowZone.Onboard && BrowserOnlyFunctions.Contains(fn.SetupFunctionName):
                return (FlowZone.Browser, $"{fn.SetupFunctionName} only exists in the browser flow.");
            case UserSetupFunctionNode fn when requested != FlowZone.Onboard && OnboardOnlyFunctions.Contains(fn.SetupFunctionName):
                return (FlowZone.Onboard, $"{fn.SetupFunctionName} only exists in the vehicle flow.");
            default:
                return (requested ?? FlowZone.Browser, null);
        }
    }

    /// <summary>Null when the link is allowed, otherwise why not.</summary>
    public static string? CheckLink(UserSetupFlowNodeBase from, UserSetupFlowNodeBase to)
    {
        if (to is UserSetupUserChannelNode or UserSetupVehicleInputNode)
            return "Inputs have no incoming connections.";
        if (from is UserSetupCarChannelNode)
            return "Vehicle channels have no outgoing connections.";
        return (SideOf(from), SideOf(to)) switch
        {
            (Side.Browser, Side.Browser) => null,
            (Side.Browser, Side.Handoff) => null,
            (Side.Handoff, Side.Onboard) => null,
            (Side.Onboard, Side.Onboard) => null,
            (Side.Browser, Side.Onboard) => "Browser nodes reach the onboard flow only through a handoff node.",
            (Side.Onboard, Side.Browser) or (Side.Handoff, Side.Browser) => "The onboard flow cannot feed the browser flow (top-down only).",
            (Side.Handoff, Side.Handoff) => "Handoffs cannot be chained.",
            _ => "The onboard flow cannot feed a handoff (top-down only).",
        };
    }

    /// <summary>True when a link from → to closes a cycle, given the existing links (from, to) of the flow.</summary>
    public static bool CreatesCycle(IEnumerable<(int From, int To)> links, int from, int to)
    {
        if (from == to) return true;
        var next = links.GroupBy(l => l.From).ToDictionary(g => g.Key, g => g.Select(l => l.To).ToList());
        var seen = new HashSet<int>();
        var stack = new Stack<int>();
        stack.Push(to);
        while (stack.Count > 0)
        {
            var n = stack.Pop();
            if (n == from) return true;
            if (!seen.Add(n)) continue;
            foreach (var m in next.GetValueOrDefault(n) ?? []) stack.Push(m);
        }
        return false;
    }

    /// <summary>
    /// Null when an output node for this channel may be in <paramref name="zone"/>; otherwise
    /// why not (T04: a channel is driven from one zone only).
    /// </summary>
    public static string? CheckChannelZone(IEnumerable<UserSetupCarChannelNode> outputsOfSetup, int carChannelId, FlowZone zone, int? exceptNodeId = null) =>
        outputsOfSetup.Any(n => n.CarChannelId == carChannelId && n.Id != exceptNodeId && n.Zone != zone)
            ? "This vehicle channel is already driven by the other flow (browser or onboard). A channel belongs to one flow only."
            : null;

    public static string ZoneName(FlowZone zone) => zone == FlowZone.Onboard ? "onboard" : "browser";
}
