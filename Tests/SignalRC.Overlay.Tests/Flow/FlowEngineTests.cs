using SignalRC.Onboard.Flow;
using SignalRC.Shared.Flow;

namespace SignalRC.Overlay.Tests.Flow;

public class FlowEngineTests
{
    private sealed class Env : IFlowEnvironment
    {
        public long NowMs { get; set; } = 1000;
        public Dictionary<int, double> Handoffs { get; } = new();
        public bool HandoffConnected { get; set; } = true;
        public Dictionary<(string, int), double> Inputs { get; } = new();
        public bool InputConnected { get; set; } = true;
        public Dictionary<string, (string, bool)> Telemetries { get; } = new();

        public (double Value, bool Connected) Handoff(int nodeId) =>
            HandoffConnected && Handoffs.TryGetValue(nodeId, out var v) ? (v, true) : (0, false);
        public (double Value, bool Connected) VehicleInput(string deviceKey, int code, bool isAxis) =>
            InputConnected && Inputs.TryGetValue((deviceKey, code), out var v) ? (v, true) : (0, false);
        public (string Value, bool Valid)? Telemetry(string channelName) =>
            Telemetries.TryGetValue(channelName, out var v) ? v : null;
        public List<string?> Disconnects { get; } = new();
        public void DisconnectControllers(string? filter) => Disconnects.Add(filter);
        public Dictionary<string, double> Published { get; } = new();
        public void PublishTelemetry(string key, double value) => Published[key] = value;
        public List<(string? Filter, double Strong, double Weak)> Rumbles { get; } = new();
        public List<(string? Filter, double R, double G, double B)> Lights { get; } = new();
        public void ControllerRumble(string? filter, double strong, double weak) => Rumbles.Add((filter, strong, weak));
        public void ControllerLight(string? filter, double red, double green, double blue) => Lights.Add((filter, red, green, blue));
    }

    private static OnboardFlowNode Fn(int id, string fn, params (string, string)[] p) =>
        new() { Id = id, Kind = OnboardFlowNodeKind.Function, Function = fn, Params = p.ToDictionary(x => x.Item1, x => (string?)x.Item2) };
    private static OnboardFlowNode Out(int id, string channel, int? resend = null) =>
        new() { Id = id, Kind = OnboardFlowNodeKind.Output, ChannelName = channel, ResendIntervalMs = resend };
    private static OnboardFlowNode Input(int id, string device, int code) =>
        new() { Id = id, Kind = OnboardFlowNodeKind.VehicleInput, InputDeviceKey = device, InputCode = code, IsAxis = true };
    private static OnboardFlowNode Handoff(int id) => new() { Id = id, Kind = OnboardFlowNodeKind.Handoff };
    private static OnboardFlowLink Link(int from, int to, string? toPort = null, string? fromPort = null) =>
        new() { From = from, To = to, ToPort = toPort, FromPort = fromPort };

    [Fact]
    public void Controller_axis_reaches_channel_through_functions_in_topological_order()
    {
        var engine = new FlowEngine();
        // Ids deliberately out of order: the output (1) depends on the function (5).
        var problems = engine.Load(new OnboardFlowDefinition
        {
            Hash = "h",
            Nodes = { Out(1, "steer"), Fn(5, "Reverse"), Input(9, "pad", 0) },
            Links = { Link(9, 5, "input"), Link(5, 1) },
        });
        Assert.Empty(problems);
        var env = new Env();
        env.Inputs[("pad", 0)] = 0.25;
        var writes = engine.Tick(env);
        Assert.Equal([new FlowChannelWrite("steer", -0.25m)], writes);
        Assert.Contains("steer", engine.OwnedChannels);
    }

    [Fact]
    public void Writes_on_change_and_resends_after_half_the_interval()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition { Nodes = { Input(1, "pad", 0), Out(2, "ch", 200) }, Links = { Link(1, 2) } });
        var env = new Env();
        env.Inputs[("pad", 0)] = 0.5;
        Assert.Single(engine.Tick(env));
        env.NowMs += 20;
        Assert.Empty(engine.Tick(env));
        env.NowMs += 80; // 100 ms = half of 200
        Assert.Single(engine.Tick(env));
        env.Inputs[("pad", 0)] = 0.6;
        env.NowMs += 20;
        Assert.Equal(0.6m, engine.Tick(env).Single().Value);
    }

    [Fact]
    public void Disconnected_sources_are_neutral_and_report_connected_zero()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Handoff(1), Out(2, "value"), Out(3, "connected") },
            Links = { Link(1, 2), Link(1, 3, fromPort: "connected") },
        });
        var env = new Env();
        env.Handoffs[1] = 0.7;
        var writes = engine.Tick(env).ToDictionary(w => w.Channel, w => w.Value);
        Assert.Equal(0.7m, writes["value"]);
        Assert.Equal(1m, writes["connected"]);
        env.HandoffConnected = false;
        env.NowMs += 10;
        writes = engine.Tick(env).ToDictionary(w => w.Channel, w => w.Value);
        Assert.Equal(0m, writes["value"]);
        Assert.Equal(0m, writes["connected"]);
    }

    [Fact]
    public void Local_controller_overrides_web_while_active()
    {
        // E12 example: Active(controller) → Priority.aActive; controller → a; handoff → b.
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Input(1, "pad", 0), Handoff(2), Fn(3, "Active", ("hold", "2")), Fn(4, "Priority"), Out(5, "steer") },
            Links = { Link(1, 3, "input"), Link(1, 4, "a"), Link(3, 4, "aActive"), Link(2, 4, "b"), Link(4, 5) },
        });
        var env = new Env();
        env.Handoffs[2] = -0.4;
        env.Inputs[("pad", 0)] = 0;
        Assert.Equal(-0.4m, engine.Tick(env).Single().Value);
        env.Inputs[("pad", 0)] = 0.9;
        env.NowMs += 20;
        Assert.Equal(0.9m, engine.Tick(env).Single().Value);
        env.Inputs[("pad", 0)] = 0;
        env.NowMs += 1000;
        Assert.Equal(0m, engine.Tick(env).Single().Value); // still overriding, stick at rest
        env.NowMs += 1500;
        Assert.Equal(-0.4m, engine.Tick(env).Single().Value);
    }

    [Fact]
    public void Reload_keeps_state_of_unchanged_nodes()
    {
        var def = new OnboardFlowDefinition
        {
            Nodes = { Input(1, "pad", 304), Fn(2, "Gearbox", ("gearNames", "R,N,1,2")), Out(3, "gear") },
            Links = { Link(1, 2, "shiftUp"), Link(2, 3) },
        };
        var engine = new FlowEngine();
        engine.Load(def);
        var env = new Env();
        env.Inputs[("pad", 304)] = 1;
        engine.Tick(env);
        Assert.Equal(2, engine.OutputsOf(2)![0]);

        // Same nodes plus a new one: gear stays.
        def.Nodes.Add(Fn(4, "Abs"));
        engine.Load(def);
        env.Inputs[("pad", 304)] = 0;
        engine.Tick(env);
        Assert.Equal(2, engine.OutputsOf(2)![0]);

        // Node 2 becomes another function: fresh state.
        def.Nodes[1] = Fn(2, "Toggle");
        engine.Load(def);
        engine.Tick(env);
        Assert.Equal(0, engine.OutputsOf(2)![0]);
    }

    [Fact]
    public void Telemetry_is_read_locally()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition { Nodes = { Fn(1, "Telemetry", ("channel", "volt")), Out(2, "x") }, Links = { Link(1, 2) } });
        var env = new Env();
        env.Telemetries["volt"] = ("12.5 V", true);
        Assert.Equal(12.5m, engine.Tick(env).Single().Value);
        Assert.Equal(1, engine.OutputsOf(1)![1]);
    }

    [Fact]
    public void Smooth_moves_towards_target_over_time()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition { Nodes = { Input(1, "pad", 0), Fn(2, "Smooth", ("speed", "0.5"), ("fps", "50")) }, Links = { Link(1, 2, "input") } });
        var env = new Env();
        env.Inputs[("pad", 0)] = 0;
        engine.Tick(env);
        env.Inputs[("pad", 0)] = 1;
        env.NowMs += 20; // one step at 50 fps
        engine.Tick(env);
        Assert.Equal(0.5, engine.OutputsOf(2)![0], 6);
        env.NowMs += 1000;
        engine.Tick(env);
        Assert.Equal(1, engine.OutputsOf(2)![0], 6);
    }

    [Fact]
    public void Unknown_function_and_cycle_are_reported_but_do_not_throw()
    {
        var engine = new FlowEngine();
        var problems = engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Fn(1, "Nope"), Fn(2, "Abs"), Fn(3, "Abs") },
            Links = { Link(2, 3, "input"), Link(3, 2, "input") },
        });
        Assert.Equal(2, problems.Count);
        engine.Tick(new Env());
    }

    [Fact]
    public void Unload_releases_ownership()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition { Nodes = { Out(1, "a") } });
        Assert.Single(engine.OwnedChannels);
        engine.Load(null);
        Assert.Empty(engine.OwnedChannels);
        Assert.Empty(engine.Tick(new Env()));
    }

    [Fact]
    public void DisconnectController_fires_once_per_press()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Input(1, "pad", 0x13c), Fn(2, "DisconnectController", ("device", "Wireless")) },
            Links = { Link(1, 2, "trigger") },
        });
        var env = new Env();
        foreach (var press in new double[] { 0, 1, 1, 0, 1 })
        {
            env.Inputs[("pad", 0x13c)] = press;
            engine.Tick(env);
        }
        Assert.Equal(["Wireless", "Wireless"], env.Disconnects);
    }

    [Fact]
    public void TelemetryOut_publishes_under_its_key()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Input(1, "pad", 0), Fn(2, "TelemetryOut", ("key", " speed ")), Fn(3, "TelemetryOut") },
            Links = { Link(1, 2, "value"), Link(1, 3, "value") },
        });
        var env = new Env();
        env.Inputs[("pad", 0)] = 0.75;
        engine.Tick(env);
        Assert.Equal(new Dictionary<string, double> { ["speed"] = 0.75 }, env.Published); // node 3 has no key
    }

    [Fact]
    public void Rumble_and_light_reach_the_controllers_clamped()
    {
        var engine = new FlowEngine();
        engine.Load(new OnboardFlowDefinition
        {
            Nodes = { Input(1, "pad", 0), Fn(2, "ControllerRumble", ("device", "Wireless")), Fn(3, "ControllerLight") },
            Links = { Link(1, 2, "strong", "value"), Link(1, 3, "blue", "value") },
        });
        var env = new Env();
        env.Inputs[("pad", 0)] = 1.5;
        engine.Tick(env);
        Assert.Equal([("Wireless", 1.0, 0.0)], env.Rumbles);
        Assert.Equal([((string?)null, 0.0, 0.0, 1.0)], env.Lights);
        Assert.Equal([1.0], engine.OutputsOf(2));
    }
}
