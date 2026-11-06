using SignalRC.Shared.Security;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>Docs/VehicleKeyAuth.md, S1: challenges are one-time nonces.</summary>
public class NonceStoreTests
{
    private sealed class FakeTime : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 6, 12, 0, 0, TimeSpan.Zero);
        public void Advance(TimeSpan by) => _now += by;
        public override DateTimeOffset GetUtcNow() => _now;
    }

    [Fact]
    public void ANonceIsAcceptedOnlyOnce()
    {
        var store = new NonceStore();
        var nonce = store.Issue();
        Assert.True(store.TryConsume(nonce));
        Assert.False(store.TryConsume(nonce));
    }

    [Fact]
    public void AnExpiredNonceIsRejected()
    {
        var time = new FakeTime();
        var store = new NonceStore(time);
        var nonce = store.Issue();
        time.Advance(TimeSpan.FromSeconds(61));
        Assert.False(store.TryConsume(nonce));
    }

    [Fact]
    public void AForeignOrUnknownNonceIsRejected()
    {
        var store = new NonceStore();
        Assert.False(store.TryConsume(null));
        Assert.False(store.TryConsume(""));
        Assert.False(store.TryConsume("deadbeef"));
        // Each issued value is random and differs from the last.
        Assert.NotEqual(store.Issue(), store.Issue());
    }

    [Fact]
    public void ANonceOnlyCountsForItsScope()
    {
        var store = new NonceStore();
        var nonce = store.Issue("connection-a");
        Assert.False(store.TryConsume(nonce, "connection-b"));
        // A wrong try burns the nonce, so it cannot be guessed against other scopes.
        Assert.False(store.TryConsume(nonce, "connection-a"));
    }

    [Fact]
    public void FloodingKeepsTheStoreBounded()
    {
        var store = new NonceStore(maxEntries: 16);
        for (var i = 0; i < 100; i++) store.Issue();
        Assert.True(store.Count <= 16);
    }
}
