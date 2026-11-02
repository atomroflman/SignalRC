using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Server.Telemetry;

namespace SignalRC.Overlay.Tests.Relay;

public class ControlDisplayRelayTests
{
    private const int Car = 3;
    private readonly FakeTransport _out = new();
    private readonly ControlDisplayRelay _relay;

    public ControlDisplayRelayTests()
    {
        _relay = new ControlDisplayRelay(_out, TimeProvider.System, NullLogger<ControlDisplayRelay>.Instance);
    }

    private Task<bool> Publish(string from, long seq, double steering = 0.5, bool paused = false) =>
        _relay.PublishAsync(from, Car, seq, paused, [(11, steering)], [("steeringRaw", 40)], [], []);

    [Fact]
    public async Task OnlyTheDriverConnectionMayPublishWithIncreasingSeq()
    {
        await _relay.ControlAcquiredAsync(Car, "driver");
        await _relay.SetInterestAsync("viewer", Car, true);
        Assert.False(await Publish("intruder", 1));
        Assert.True(await Publish("driver", 1));
        Assert.False(await Publish("driver", 1));
        Assert.Single(_out.Sent);
        Assert.Equal("viewer", _out.Sent[0].Connection);
        Assert.Equal("[[11,0.5]]", System.Text.Json.JsonSerializer.Serialize(_out.Sent[0].Outputs));
    }

    [Fact]
    public async Task TheDriverIsToldWhetherAnyoneWatches()
    {
        await _relay.ControlAcquiredAsync(Car, "driver");
        await _relay.SetInterestAsync("driver", Car, true);
        await _relay.SetInterestAsync("viewer", Car, true);
        await _relay.SetInterestAsync("viewer", Car, false);
        Assert.Equal([false, true, false], _out.Demands.Select(d => d.Needed));
        Assert.All(_out.Demands, d => Assert.Equal("driver", d.Connection));
    }

    [Fact]
    public async Task ANewDriverVoidsTheOldValues()
    {
        await _relay.ControlAcquiredAsync(Car, "driver");
        await _relay.SetInterestAsync("viewer", Car, true);
        await Publish("driver", 1);
        var epoch = _out.Sent[0].Epoch;
        await _relay.ControlAcquiredAsync(Car, "other");
        Assert.Equal([("viewer", epoch)], _out.Cleared);
        Assert.False(await Publish("driver", 2));
        Assert.True(await Publish("other", 1));
        Assert.NotEqual(epoch, _out.Sent[^1].Epoch);
    }

    [Fact]
    public async Task ANewViewerGetsTheCurrentStateIncludingPause()
    {
        await _relay.ControlAcquiredAsync(Car, "driver");
        await _relay.SetInterestAsync("first", Car, true);
        await Publish("driver", 1, paused: true);
        await _relay.PublishAsync("driver", Car, 2, true, [], [], [], ["steeringRaw"]);
        await _relay.SetInterestAsync("late", Car, true);
        var snapshot = _out.Sent.Single(s => s.Connection == "late");
        Assert.True(snapshot.Paused);
        Assert.Equal("[[11,0.5]]", System.Text.Json.JsonSerializer.Serialize(snapshot.Outputs));
        Assert.Empty(snapshot.Signals);
    }

    [Fact]
    public async Task DriverDisconnectClearsForViewers()
    {
        await _relay.ControlAcquiredAsync(Car, "driver");
        await _relay.SetInterestAsync("viewer", Car, true);
        await Publish("driver", 1);
        await _relay.ConnectionClosedAsync("driver");
        Assert.Single(_out.Cleared);
        Assert.False(await Publish("driver", 2));
    }

    private sealed class FakeTransport : IControlDisplayTransport
    {
        public readonly List<(string Connection, string Epoch, long Seq, bool Paused, int Age, object[][] Outputs, object[][] Signals)> Sent = [];
        public readonly List<(string Connection, string Epoch)> Cleared = [];
        public readonly List<(string Connection, bool Needed)> Demands = [];

        public Task SendAsync(string connectionId, int carId, string driverEpoch, long seq, bool paused, int ageMs,
            object[][] outputs, object[][] signals, int[] removedOutputs, string[] removedSignals)
        {
            Sent.Add((connectionId, driverEpoch, seq, paused, ageMs, outputs, signals));
            return Task.CompletedTask;
        }

        public Task SendClearedAsync(string connectionId, int carId, string driverEpoch)
        {
            Cleared.Add((connectionId, driverEpoch));
            return Task.CompletedTask;
        }

        public Task SendDemandAsync(string driverConnectionId, int carId, bool needed)
        {
            Demands.Add((driverConnectionId, needed));
            return Task.CompletedTask;
        }
    }
}
