using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Data;
using SignalRC.Onboard.Flow;
using SignalRC.Onboard.Input;
using SignalRC.Onboard.Services;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Flow;

namespace SignalRC.Overlay.Tests.Flow;

// OF06 / T08 / T09 / E07 / E13: handoff timeout, web detach, server loss, channel ownership.
public class OnboardFlowServiceTests
{
    private sealed class Sink : IControlSink
    {
        public Dictionary<string, decimal> Values { get; } = new();
        public List<string> Released { get; } = new();
        public string[] All { get; set; } = ["steer", "light", "horn"];
        public void SetControl(string channel, decimal value) => Values[channel] = value;
        public void ReleaseControl(Func<string, bool> include) => Released.AddRange(All.Where(include));
    }

    private static (OnboardFlowService Service, Sink Sink, long[] Now) Create()
    {
        var map = new ChannelMap();
        var config = new ConfigurationBuilder().Build();
        var telemetry = new TelemetryService(map, null!, config, NullLogger<TelemetryService>.Instance, null!, new ServerCarConfigurationService());
        var server = new ServerConnectionService(map, config, null!, NullLogger<ServerConnectionService>.Instance, null!, null!);
        var sink = new Sink();
        var now = new long[] { 1000 };
        var service = new OnboardFlowService(NullLogger<OnboardFlowService>.Instance, sink, telemetry, new VehicleInputService(NullLogger<VehicleInputService>.Instance), server)
        {
            AutoTick = false,
            Clock = () => now[0],
        };
        return (service, sink, now);
    }

    /// <summary>Handoff 1 → output "steer"; its "connected" → output "horn".</summary>
    private static OnboardFlowDefinition Flow(string hash = "h1") => new()
    {
        Hash = hash,
        Nodes =
        {
            new OnboardFlowNode { Id = 1, Kind = OnboardFlowNodeKind.Handoff },
            new OnboardFlowNode { Id = 2, Kind = OnboardFlowNodeKind.Output, ChannelName = "steer" },
            new OnboardFlowNode { Id = 3, Kind = OnboardFlowNodeKind.Output, ChannelName = "horn" },
        },
        Links = { new OnboardFlowLink { From = 1, To = 2 }, new OnboardFlowLink { From = 1, FromPort = "connected", To = 3 } },
    };

    [Fact]
    public void Handoff_values_arrive_while_fresh_and_server_is_there()
    {
        var (service, sink, now) = Create();
        service.OnServerConnected();
        service.Apply(Flow());
        service.SetHandoff(1, 0.4);
        service.TickOnce();
        Assert.Equal(0.4m, sink.Values["steer"]);
        Assert.Equal(1m, sink.Values["horn"]);

        now[0] += OnboardFlowService.HandoffTimeoutMs + 1;
        service.TickOnce();
        Assert.Equal(0m, sink.Values["steer"]);
        Assert.Equal(0m, sink.Values["horn"]);
    }

    [Fact]
    public void Server_loss_disconnects_handoffs_but_the_flow_keeps_running()
    {
        var (service, sink, now) = Create();
        service.OnServerConnected();
        service.Apply(Flow());
        service.SetHandoff(1, 0.4);
        service.OnServerLost();
        service.SetHandoff(1, 0.9); // a late value from before the loss counts neither
        now[0] += 20;
        service.TickOnce();
        Assert.True(service.IsActive);
        Assert.Equal(0m, sink.Values["horn"]);
    }

    [Fact]
    public void Detach_needs_a_flow_releases_browser_channels_and_disconnects_handoffs()
    {
        var (service, sink, _) = Create();
        service.OnServerConnected();
        Assert.False(service.SetWebDetached(true)); // no flow loaded
        service.Apply(Flow());
        service.SetHandoff(1, 0.4);
        Assert.True(service.SetWebDetached(true));
        Assert.True(service.WebDetached);
        // Only "light" belongs to the browser; the flow keeps steer and horn.
        Assert.Equal(["light"], sink.Released);
        service.SetHandoff(1, 0.7);
        service.TickOnce();
        Assert.Equal(0m, sink.Values["steer"]);
        Assert.False(service.SetWebDetached(false));
    }

    [Fact]
    public void Owned_channels_follow_the_flow_and_dropped_ones_go_neutral()
    {
        var (service, sink, _) = Create();
        service.Apply(Flow());
        Assert.True(service.OwnsChannel("steer"));
        Assert.False(service.OwnsChannel("light"));

        var smaller = Flow("h2");
        smaller.Nodes.RemoveAll(n => n.Id == 3);
        smaller.Links.RemoveAll(l => l.To == 3);
        service.Apply(smaller);
        Assert.Equal(["horn"], sink.Released);
        Assert.False(service.OwnsChannel("horn"));

        sink.Released.Clear();
        service.SetWebDetached(true);
        sink.Released.Clear();
        service.Clear();
        Assert.Equal(["steer"], sink.Released);
        Assert.False(service.IsActive);
        Assert.False(service.WebDetached); // a new session starts attached (E10)
    }

    [Fact]
    public void Paused_flow_writes_nothing()
    {
        var (service, sink, _) = Create();
        service.Apply(Flow());
        service.Pause(true);
        service.TickOnce();
        Assert.Empty(sink.Values);
    }

    [Fact]
    public void Status_reports_mode_and_owned_channels()
    {
        var (service, _, _) = Create();
        Assert.Equal(OnboardFlowMode.Off, service.Status().Mode);
        service.Apply(Flow());
        Assert.Equal(OnboardFlowMode.Mixed, service.Status().Mode);
        Assert.Equal(["horn", "steer"], service.Status().OwnedChannels);
        service.SetWebDetached(true);
        Assert.Equal(OnboardFlowMode.Detached, service.Status().Mode);
    }

    [Fact]
    public void Node_values_only_while_an_editor_wants_them()
    {
        var (service, _, _) = Create();
        service.OnServerConnected();
        service.Apply(Flow());
        service.SetHandoff(1, 0.4);
        service.TickOnce();
        Assert.Empty(service.Status().Outputs);
        service.SetValueDemand(true);
        var outputs = service.Status().Outputs;
        Assert.Equal([0.4, 1], outputs[1]); // handoff: value and connected
        Assert.Equal([0.4], outputs[2]);
        service.OnServerLost();
        Assert.False(service.ValuesWanted);
    }

    [Fact]
    public void Disconnect_targets_connected_bluetooth_controllers_matching_the_filter()
    {
        VehicleInputDeviceState[] devices =
        [
            new() { Key = "aa:bb:cc:dd:ee:ff/Wireless Controller", Name = "Wireless Controller", Connected = true },
            new() { Key = "11:22:33:44:55:66/Xbox Wireless Controller", Name = "Xbox Wireless Controller", Connected = false },
            new() { Key = "054c:09cc/USB Pad", Name = "USB Pad", Connected = true },
        ];
        Assert.Equal(["AA:BB:CC:DD:EE:FF"], OnboardFlowService.BluetoothAddresses(devices, ""));
        Assert.Equal(["AA:BB:CC:DD:EE:FF"], OnboardFlowService.BluetoothAddresses(devices, "wireless"));
        Assert.Empty(OnboardFlowService.BluetoothAddresses(devices, "xbox")); // not connected
        Assert.Empty(OnboardFlowService.BluetoothAddresses(devices, "usb"));  // no Bluetooth address
    }
}
