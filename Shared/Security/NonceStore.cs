using System.Collections.Concurrent;
using System.Security.Cryptography;

namespace SignalRC.Shared.Security;

/// <summary>
/// One-time challenges (Docs/VehicleKeyAuth.md): a nonce is valid for a short time,
/// only for the scope it was issued to, and only once. A replayed or foreign
/// signature therefore never opens a session.
/// </summary>
public sealed class NonceStore
{
    public static readonly TimeSpan DefaultLifetime = TimeSpan.FromSeconds(60);

    private readonly ConcurrentDictionary<string, Entry> _issued = new();
    private readonly TimeProvider _time;
    private readonly TimeSpan _lifetime;
    private readonly int _maxEntries;

    private readonly record struct Entry(string Scope, DateTimeOffset Expires);

    public NonceStore(TimeProvider? time = null, TimeSpan? lifetime = null, int maxEntries = 1024)
    {
        _time = time ?? TimeProvider.System;
        _lifetime = lifetime ?? DefaultLifetime;
        _maxEntries = maxEntries;
    }

    /// <summary>A fresh nonce for <paramref name="scope"/> (e.g. a connection or a vehicle).</summary>
    public string Issue(string scope = "")
    {
        Prune();
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        _issued[nonce] = new Entry(scope, _time.GetUtcNow() + _lifetime);
        return nonce;
    }

    /// <summary>True once for an issued, unexpired nonce of this scope; the nonce is gone afterwards either way.</summary>
    public bool TryConsume(string? nonce, string scope = "")
    {
        if (string.IsNullOrEmpty(nonce) || !_issued.TryRemove(nonce, out var entry))
            return false;
        return entry.Scope == scope && entry.Expires > _time.GetUtcNow();
    }

    public int Count => _issued.Count;

    // Expired entries go first; if someone floods the store, the oldest are dropped
    // so memory stays bounded (their holders simply ask again).
    private void Prune()
    {
        var now = _time.GetUtcNow();
        foreach (var (key, entry) in _issued)
            if (entry.Expires <= now) _issued.TryRemove(key, out _);
        if (_issued.Count < _maxEntries) return;
        foreach (var (key, _) in _issued.OrderBy(kv => kv.Value.Expires).Take(_issued.Count - _maxEntries + 1))
            _issued.TryRemove(key, out _);
    }
}
