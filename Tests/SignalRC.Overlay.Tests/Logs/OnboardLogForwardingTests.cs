using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Services;
using SignalRC.Server.Services;
using SignalRC.Shared.Logs;

namespace SignalRC.Overlay.Tests.Logs;

/// <summary>The onboard log reaches the GUI through the server: buffered on the vehicle, kept per car on the server.</summary>
public class OnboardLogForwardingTests
{
    [Fact]
    public void ForwarderBuffersFromMinLevelAndSkipsSignalR()
    {
        using var forwarder = new ServerLogForwarder(LogLevel.Information);
        forwarder.CreateLogger("SignalRC.Onboard.Control.ControlExecutionService").LogDebug("noise");
        forwarder.CreateLogger("SignalRC.Onboard.Control.ControlExecutionService").LogError(new IOException("i2c"), "Channel {Channel} failed", "steer");
        forwarder.CreateLogger("Microsoft.AspNetCore.SignalR.Client.HubConnection").LogError("would loop");

        var entry = Assert.Single(Take(forwarder));
        Assert.Equal((int)LogLevel.Error, entry.Level);
        Assert.Equal("Channel steer failed", entry.Message);
        Assert.Contains("IOException: i2c", entry.Exception);
    }

    [Fact]
    public void ForwarderDropsOldestWhenFullAndSaysSo()
    {
        using var forwarder = new ServerLogForwarder(LogLevel.Information);
        var logger = forwarder.CreateLogger("t");
        for (var i = 0; i < 5010; i++) logger.LogInformation("line {I}", i);

        var batch = Take(forwarder);
        Assert.Contains("10 log entries dropped", batch[0].Message);
        Assert.Equal("line 10", batch[1].Message);
    }

    [Fact]
    public void StoreNumbersEntriesAndReturnsWhatIsNew()
    {
        var store = new OnboardLogStore();
        store.Add(1, [new OnboardLogEntry { Message = "a" }, new OnboardLogEntry { Message = "b" }]);
        store.Add(2, [new OnboardLogEntry { Message = "other car" }]);

        var (all, last) = store.Get(1, 0, 100);
        Assert.Equal(new[] { "a", "b" }, all.Select(e => e.Message));
        Assert.Equal(2, last);
        Assert.Equal("b", Assert.Single(store.Get(1, 1, 100).Entries).Message);

        store.Clear(1);
        store.Add(1, [new OnboardLogEntry { Message = "c" }]);
        Assert.Equal(3, Assert.Single(store.Get(1, 0, 100).Entries).Seq);
    }

    [Fact]
    public void StoreKeepsTheNewestEntries()
    {
        var store = new OnboardLogStore();
        store.Add(1, Enumerable.Range(0, OnboardLogStore.Capacity + 5).Select(i => new OnboardLogEntry { Message = $"{i}" }));
        var (entries, _) = store.Get(1, 0, 10);
        Assert.Equal(10, entries.Length);
        Assert.Equal($"{OnboardLogStore.Capacity + 4}", entries[^1].Message);
        Assert.Equal("5", store.Get(1, 0, OnboardLogStore.Capacity).Entries[0].Message);
    }

    private static OnboardLogEntry[] Take(ServerLogForwarder forwarder) => forwarder.TakeBatch();
}
