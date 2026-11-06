using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace SignalRC.Server.Security;

/// <summary>
/// Config sessions (Docs/VehicleKeyAuth.md): opened by a signature of the owner key
/// against the owner public key in the database, so they also work while the vehicle
/// is offline. They allow configuring, never driving. The token lives in an HttpOnly
/// session cookie; only its hash is kept here, in memory: a server restart ends all
/// sessions and the browser simply signs again.
/// </summary>
public sealed class ConfigSessionStore(TimeProvider? time = null)
{
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromHours(2);

    private readonly TimeProvider _time = time ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, Session> _sessions = new();

    private sealed record Session(int CarId, string OwnerKeyFingerprint)
    {
        public DateTimeOffset LastUsed { get; set; }
    }

    public static string CookieName(int carId) => $"SignalRCCfg{carId}";

    /// <summary>A new session for <paramref name="carId"/>; returns the token for the cookie.</summary>
    public string Create(int carId, string ownerKeyFingerprint)
    {
        Prune();
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        _sessions[Hash(token)] = new Session(carId, ownerKeyFingerprint) { LastUsed = _time.GetUtcNow() };
        return token;
    }

    /// <summary>
    /// True for a live session of this car under the current owner key; each use
    /// moves the idle timeout.
    /// </summary>
    public bool IsValid(int carId, string? token, string? currentOwnerKeyFingerprint)
    {
        if (string.IsNullOrEmpty(token) || currentOwnerKeyFingerprint == null) return false;
        var key = Hash(token);
        if (!_sessions.TryGetValue(key, out var session)) return false;
        var now = _time.GetUtcNow();
        if (session.CarId != carId) return false;
        if (now - session.LastUsed > IdleTimeout || session.OwnerKeyFingerprint != currentOwnerKeyFingerprint)
        {
            _sessions.TryRemove(key, out _);
            return false;
        }
        session.LastUsed = now;
        return true;
    }

    /// <summary>When the session ends without further use; null if there is none.</summary>
    public DateTimeOffset? ExpiresAt(int carId, string? token)
    {
        if (string.IsNullOrEmpty(token) || !_sessions.TryGetValue(Hash(token), out var session) || session.CarId != carId) return null;
        return session.LastUsed + IdleTimeout;
    }

    public void Revoke(string? token)
    {
        if (!string.IsNullOrEmpty(token)) _sessions.TryRemove(Hash(token), out _);
    }

    /// <summary>Ends every session of the car, e.g. when its owner key changed.</summary>
    public int RevokeCar(int carId)
    {
        var removed = 0;
        foreach (var (key, session) in _sessions)
            if (session.CarId == carId && _sessions.TryRemove(key, out _)) removed++;
        return removed;
    }

    public int Count => _sessions.Count;

    private void Prune()
    {
        var now = _time.GetUtcNow();
        foreach (var (key, session) in _sessions)
            if (now - session.LastUsed > IdleTimeout) _sessions.TryRemove(key, out _);
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
}
