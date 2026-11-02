using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Server;
using SignalRC.Server.Telemetry;

namespace SignalRC.Overlay.Tests.Relay;

// AP13: after a reconnect the driver's new connection proves its control session
// and becomes the control display connection again (D57).
public class ControlDisplayResumeTests
{
    private const int Car = 3;
    private readonly ControlDisplayRelayTests.FakeTransport _out = new();
    private readonly ControlDisplayRelay _relay;
    private readonly CarConnectionStore _store = new();

    public ControlDisplayResumeTests()
    {
        _relay = new ControlDisplayRelay(_out, TimeProvider.System, NullLogger<ControlDisplayRelay>.Instance);
        _store.RegisterConnection(Car.ToString(), "onboard");
    }

    private Task<bool> Publish(string from, long seq) =>
        _relay.PublishAsync(from, Car, seq, false, [(11, 0.5)], [], [], []);

    private async Task AcquireAsync(string connection, string session)
    {
        _store.RememberControlSession(Car.ToString(), session);
        await _relay.ControlAcquiredAsync(Car, connection);
    }

    [Fact]
    public async Task TheNewConnectionWithTheValidSessionBecomesTheDriver()
    {
        await AcquireAsync("old", "sess-1");
        await _relay.SetInterestAsync("viewer", Car, true);
        Assert.True(await Publish("old", 1));

        Assert.True(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-1", "new"));
        Assert.False(await Publish("old", 2));
        Assert.True(await Publish("new", 1));
        // Viewers drop the old epoch; the new connection is told there is demand.
        Assert.Single(_out.Cleared);
        Assert.Equal(("new", true), (_out.Demands[^1].Connection, _out.Demands[^1].Needed));

        // The old connection closing afterwards does not end the resumed driver.
        await _relay.ConnectionClosedAsync("old");
        Assert.True(await Publish("new", 2));
    }

    [Fact]
    public async Task ResumeWorksAlsoWhenTheOldConnectionClosedFirst()
    {
        await AcquireAsync("old", "sess-1");
        await _relay.ConnectionClosedAsync("old");
        Assert.True(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-1", "new"));
        Assert.True(await Publish("new", 1));
    }

    [Fact]
    public async Task WithoutTheValidSessionNothingChanges()
    {
        await AcquireAsync("driver", "sess-1");
        foreach (var wrong in new[] { "sess-2", "", null, "SESS-1" })
        {
            Assert.False(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, wrong, "intruder"));
        }
        Assert.False(await ControlDisplayResume.TryResumeAsync(_store, _relay, 99, "sess-1", "intruder"));
        Assert.True(await Publish("driver", 1));
        Assert.False(await Publish("intruder", 2));
    }

    [Fact]
    public async Task ReleasedReplacedOrOnboardLostSessionsCannotBeResumed()
    {
        await AcquireAsync("a", "sess-1");
        _store.ForgetControlSession(Car.ToString(), "other");
        Assert.True(_store.IsControlSession(Car.ToString(), "sess-1"));
        _store.ForgetControlSession(Car.ToString(), "sess-1");
        Assert.False(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-1", "b"));

        await AcquireAsync("a", "sess-2");
        await AcquireAsync("c", "sess-3");
        Assert.False(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-2", "b"));
        Assert.True(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-3", "d"));

        // The session lives with the onboard connection: a vehicle disconnect ends it.
        Assert.True(_store.TryRemoveConnection("onboard", out _, out _));
        Assert.False(await ControlDisplayResume.TryResumeAsync(_store, _relay, Car, "sess-3", "e"));
    }
}
