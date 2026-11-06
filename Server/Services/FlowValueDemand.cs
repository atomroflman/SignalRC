using System.Collections.Concurrent;

namespace SignalRC.Server.Services;

/// <summary>
/// Which browser connections show the onboard flow values of which vehicle (flow editor).
/// The vehicle sends node values only while at least one does, so they cost no bandwidth
/// while driving.
/// </summary>
public sealed class FlowValueDemand
{
    private readonly ConcurrentDictionary<int, HashSet<string>> _byCar = new();
    private readonly object _lock = new();

    /// <summary>Adds the connection; true when the vehicle had no viewer before.</summary>
    public bool Add(int carId, string connectionId)
    {
        lock (_lock)
        {
            var set = _byCar.GetOrAdd(carId, _ => new HashSet<string>(StringComparer.Ordinal));
            return set.Add(connectionId) && set.Count == 1;
        }
    }

    /// <summary>Removes the connection; true when it was the vehicle's last viewer.</summary>
    public bool Remove(int carId, string connectionId)
    {
        lock (_lock)
        {
            return _byCar.TryGetValue(carId, out var set) && set.Remove(connectionId) && set.Count == 0;
        }
    }

    /// <summary>Removes a closed connection everywhere; returns the vehicles that lost their last viewer.</summary>
    public List<int> RemoveConnection(string connectionId)
    {
        lock (_lock)
        {
            var emptied = new List<int>();
            foreach (var (carId, set) in _byCar)
                if (set.Remove(connectionId) && set.Count == 0) emptied.Add(carId);
            return emptied;
        }
    }

    public bool IsWanted(int carId)
    {
        lock (_lock) return _byCar.TryGetValue(carId, out var set) && set.Count > 0;
    }
}
