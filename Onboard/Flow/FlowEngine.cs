using SignalRC.Shared.Flow;

namespace SignalRC.Onboard.Flow;

/// <summary>Inputs of the onboard flow from outside: handoffs, controllers, telemetry.</summary>
public interface IFlowEnvironment
{
    long NowMs { get; }
    /// <summary>Value of a handoff node from the browser; not connected → (0, false) (E08).</summary>
    (double Value, bool Connected) Handoff(int nodeId);
    /// <summary>Value of a controller axis or button; not connected → (0, false).</summary>
    (double Value, bool Connected) VehicleInput(string deviceKey, int code, bool isAxis);
    (string Value, bool Valid)? Telemetry(string channelName);
}

/// <summary>A value the engine wants written to a control channel.</summary>
public readonly record struct FlowChannelWrite(string Channel, decimal Value);

/// <summary>
/// The onboard flow engine (OnboardFlow-Arbeitspakete.md OF01). Evaluates the whole
/// onboard flow once per tick in topological order and decides which control channels
/// have to be written (on change, and again after half the resend interval, T07).
/// Not thread-safe: the owner serializes Load and Tick.
/// </summary>
public sealed class FlowEngine
{
    public const int DefaultResendIntervalMs = 400;

    private sealed class Node
    {
        public required OnboardFlowNode Def { get; init; }
        public FlowFunction? Function { get; init; }
        public object? State { get; set; }
        public double[] Outputs { get; set; } = [0];
        /// <summary>Incoming links (by target port; an output node has exactly one, without port).</summary>
        public List<OnboardFlowLink> Incoming { get; } = new();
    }

    private sealed class Sent { public decimal Value; public long AtMs; }

    private Dictionary<int, Node> _nodes = new();
    private List<Node> _order = new();
    private readonly Dictionary<string, Sent> _sent = new(StringComparer.Ordinal);

    public OnboardFlowDefinition? Definition { get; private set; }

    /// <summary>Control channels driven by the loaded flow.</summary>
    public IReadOnlySet<string> OwnedChannels { get; private set; } = new HashSet<string>();

    /// <summary>
    /// Replaces the flow. A node keeps its state when id and function stay the same (E09).
    /// Returns the problems found (unknown functions, links to missing nodes, cycles); the
    /// flow runs without the affected parts.
    /// </summary>
    public IReadOnlyList<string> Load(OnboardFlowDefinition? definition)
    {
        var problems = new List<string>();
        var old = _nodes;
        var nodes = new Dictionary<int, Node>();
        Definition = definition;
        if (definition == null)
        {
            _nodes = nodes;
            _order = new();
            OwnedChannels = new HashSet<string>();
            _sent.Clear();
            return problems;
        }

        foreach (var def in definition.Nodes)
        {
            FlowFunction? fn = null;
            if (def.Kind == OnboardFlowNodeKind.Function)
            {
                fn = FlowFunctions.Get(def.Function);
                if (fn == null) problems.Add($"Node {def.Id}: unknown function '{def.Function}'");
            }
            var node = new Node { Def = def, Function = fn };
            if (old.TryGetValue(def.Id, out var previous) && previous.Def.Kind == def.Kind && previous.Def.Function == def.Function)
            {
                node.State = previous.State;
                node.Outputs = previous.Outputs;
            }
            else
            {
                node.State = fn?.CreateState();
            }
            nodes[def.Id] = node;
        }

        foreach (var link in definition.Links)
        {
            if (!nodes.ContainsKey(link.From) || !nodes.TryGetValue(link.To, out var target))
            {
                problems.Add($"Link {link.From} → {link.To}: node missing");
                continue;
            }
            target.Incoming.Add(link);
        }

        _nodes = nodes;
        _order = TopologicalOrder(nodes, problems);
        var owned = nodes.Values
            .Where(n => n.Def.Kind == OnboardFlowNodeKind.Output && !string.IsNullOrEmpty(n.Def.ChannelName))
            .Select(n => n.Def.ChannelName!)
            .ToHashSet(StringComparer.Ordinal);
        OwnedChannels = owned;
        foreach (var channel in _sent.Keys.Where(c => !owned.Contains(c)).ToList())
            _sent.Remove(channel);
        return problems;
    }

    /// <summary>First output of every node, for the status (T13).</summary>
    public Dictionary<int, double> Values() =>
        _nodes.ToDictionary(kv => kv.Key, kv => kv.Value.Outputs.Length > 0 && double.IsFinite(kv.Value.Outputs[0]) ? kv.Value.Outputs[0] : 0);

    /// <summary>All outputs of a node (tests, diagnostics).</summary>
    public double[]? OutputsOf(int nodeId) => _nodes.TryGetValue(nodeId, out var n) ? n.Outputs : null;

    /// <summary>Evaluates the flow once and returns the channel writes that are due.</summary>
    public List<FlowChannelWrite> Tick(IFlowEnvironment env)
    {
        var writes = new List<FlowChannelWrite>();
        var ctx = new Context(env);
        foreach (var node in _order)
        {
            var def = node.Def;
            switch (def.Kind)
            {
                case OnboardFlowNodeKind.Handoff:
                {
                    var (value, connected) = env.Handoff(def.Id);
                    node.Outputs = connected ? [value, 1] : [0, 0];
                    break;
                }
                case OnboardFlowNodeKind.VehicleInput:
                {
                    var (value, connected) = env.VehicleInput(def.InputDeviceKey ?? string.Empty, def.InputCode, def.IsAxis);
                    node.Outputs = connected ? [value, 1] : [0, 0];
                    break;
                }
                case OnboardFlowNodeKind.Function when node.Function != null:
                {
                    var inputs = new Dictionary<string, double>(StringComparer.Ordinal);
                    foreach (var label in node.Function.Inputs)
                    {
                        var link = node.Incoming.FirstOrDefault(l => l.ToPort == label);
                        inputs[label] = link != null ? EdgeValue(link) : 0;
                    }
                    double[] outputs;
                    try
                    {
                        outputs = node.Function.Apply(inputs, def.Params, node.State, ctx);
                    }
                    catch (Exception)
                    {
                        outputs = [0];
                    }
                    node.Outputs = outputs.Length > 0 ? outputs : [0];
                    break;
                }
                case OnboardFlowNodeKind.Output:
                {
                    var link = node.Incoming.FirstOrDefault();
                    if (link == null || string.IsNullOrEmpty(def.ChannelName))
                        break;
                    var value = EdgeValue(link);
                    node.Outputs = [value];
                    if (Math.Abs(value) > 1e15)
                        break; // out of range for the channel (and for decimal)
                    var dec = (decimal)value;
                    var resend = Math.Max(20, (def.ResendIntervalMs is > 0 ? def.ResendIntervalMs.Value : DefaultResendIntervalMs) / 2);
                    if (!_sent.TryGetValue(def.ChannelName, out var sent) || sent.Value != dec || env.NowMs - sent.AtMs >= resend)
                    {
                        _sent[def.ChannelName] = new Sent { Value = dec, AtMs = env.NowMs };
                        writes.Add(new FlowChannelWrite(def.ChannelName, dec));
                    }
                    break;
                }
            }
        }
        return writes;
    }

    /// <summary>Forgets what was sent, so every channel is written on the next tick.</summary>
    public void ResendAll() => _sent.Clear();

    /// <summary>The value an edge carries; non-finite values count as 0, like edgeValue in the browser.</summary>
    private double EdgeValue(OnboardFlowLink link)
    {
        if (!_nodes.TryGetValue(link.From, out var source)) return 0;
        var port = 0;
        if (!string.IsNullOrEmpty(link.FromPort))
        {
            var labels = source.Function?.Outputs
                ?? (source.Def.Kind is OnboardFlowNodeKind.Handoff or OnboardFlowNodeKind.VehicleInput ? ["value", "connected"] : []);
            port = Math.Max(0, Array.IndexOf(labels, link.FromPort));
        }
        var v = port < source.Outputs.Length ? source.Outputs[port] : 0;
        return double.IsFinite(v) ? v : 0;
    }

    private static List<Node> TopologicalOrder(Dictionary<int, Node> nodes, List<string> problems)
    {
        var indegree = nodes.ToDictionary(kv => kv.Key, kv => kv.Value.Incoming.Select(l => l.From).Distinct().Count());
        var outgoing = new Dictionary<int, List<int>>();
        foreach (var node in nodes.Values)
            foreach (var from in node.Incoming.Select(l => l.From).Distinct())
            {
                if (!outgoing.TryGetValue(from, out var list)) outgoing[from] = list = new();
                list.Add(node.Def.Id);
            }

        var ready = new SortedSet<int>(indegree.Where(kv => kv.Value == 0).Select(kv => kv.Key));
        var order = new List<Node>(nodes.Count);
        while (ready.Count > 0)
        {
            var id = ready.Min;
            ready.Remove(id);
            order.Add(nodes[id]);
            foreach (var next in outgoing.GetValueOrDefault(id) ?? [])
                if (--indegree[next] == 0) ready.Add(next);
        }
        if (order.Count < nodes.Count)
        {
            // The server refuses cycles (T03); should one arrive anyway, its nodes run in id
            // order with the values of the previous tick.
            var rest = nodes.Keys.Except(order.Select(n => n.Def.Id)).OrderBy(id => id).ToList();
            problems.Add($"Cycle between nodes {string.Join(", ", rest)}");
            order.AddRange(rest.Select(id => nodes[id]));
        }
        return order;
    }

    private sealed class Context(IFlowEnvironment env) : IFlowFunctionContext
    {
        public long NowMs => env.NowMs;
        public (string Value, bool Valid)? Telemetry(string channelName) => env.Telemetry(channelName);
    }
}
