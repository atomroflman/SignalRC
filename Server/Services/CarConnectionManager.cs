using System.Collections.Concurrent;
using SignalRC.Shared;

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
}