using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using SignalRC.Shared;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Update;

namespace SignalRC.Server;

public class CarConnectionStore : ConcurrentDictionary<string, CarConnectionInfo>
{
    private readonly ConcurrentDictionary<string, string> _connectionToCarMap = new();

    public CarConnectionInfo RegisterConnection(string carId, string connectionId)
    {
        _connectionToCarMap[connectionId] = carId;
        return AddOrUpdate(carId,
            _ => new CarConnectionInfo { ConnectionId = connectionId },
            (_, existing) =>
            {
                existing.ConnectionId = connectionId;
                return existing;
            });
    }

    public bool TryRemoveConnection(string connectionId, out string? carId, out CarConnectionInfo? connectionInfo)
    {
        connectionInfo = null;
        carId = null;

        if (!_connectionToCarMap.TryRemove(connectionId, out var mappedCarId))
        {
            return false;
        }

        carId = mappedCarId;
        if (!TryGetValue(mappedCarId, out var currentInfo) || currentInfo.ConnectionId != connectionId)
        {
            return false;
        }

        return TryRemove(mappedCarId, out connectionInfo);
    }

    /// <summary>The vehicle whose current onboard connection this is; false for stale or foreign connections.</summary>
    public bool TryGetCarId(string connectionId, out int carId)
    {
        carId = 0;
        return _connectionToCarMap.TryGetValue(connectionId, out var mapped)
            && TryGetValue(mapped, out var info) && info.ConnectionId == connectionId
            && int.TryParse(mapped, out carId);
    }

    /// <summary>
    /// The control session the onboard issued through AquireCarControl (D57). Kept
    /// as hash with the onboard connection's info, so it ends with that connection.
    /// </summary>
    public void RememberControlSession(string carId, string sessionId)
    {
        if (TryGetValue(carId, out var info)) info.ControlSessionHash = CarConnectionInfo.Hash(sessionId);
    }

    /// <summary>Forgets the session if it is the given one (ReleaseCarControl with a foreign id changes nothing).</summary>
    public void ForgetControlSession(string carId, string sessionId)
    {
        if (TryGetValue(carId, out var info) && info.IsControlSession(sessionId)) info.ControlSessionHash = null;
    }

    /// <summary>True when <paramref name="sessionId"/> is the vehicle's current control session.</summary>
    public bool IsControlSession(string carId, string? sessionId) =>
        TryGetValue(carId, out var info) && info.IsControlSession(sessionId);

    public bool TrySetOnboardVersion(string carId, string branch, string? commit)
    {
        if (!TryGetValue(carId, out var info))
        {
            return false;
        }
        info.OnboardBranch = branch;
        info.OnboardCommit = commit;
        return true;
    }
}

public class CarConnectionInfo
{
    public string? ConnectionId { get; set; }
    public CarConfiguration CarConfiguration { get; set; } = new CarConfiguration();
    public string? DriverId { get; set; }
    public string? DriverName { get; set; }
    public string? OnboardBranch { get; set; }
    public string? OnboardCommit { get; set; }
    /// <summary>Latest channel health the onboard sent; null for onboard builds that don't report it.</summary>
    public ChannelHealthReport? ChannelHealth { get; set; }
    /// <summary>Latest self-update status the onboard sent; null for onboard builds that don't report it.</summary>
    public OnboardUpdateStatus? UpdateStatus { get; set; }
    /// <summary>SHA-256 of the current control session, null without one.</summary>
    public byte[]? ControlSessionHash { get; set; }

    public bool IsControlSession(string? sessionId)
    {
        var current = ControlSessionHash;
        return current != null && !string.IsNullOrEmpty(sessionId) && CryptographicOperations.FixedTimeEquals(current, Hash(sessionId));
    }

    internal static byte[] Hash(string sessionId) => SHA256.HashData(Encoding.UTF8.GetBytes(sessionId));
}