using System.Collections.Concurrent;

namespace SignalRC.Server.Services;

/// <summary>
/// Remembers which browser connection is currently pushing audio to which car, so a dropped
/// browser can stop the vehicle speaker immediately instead of waiting for the Onboard's idle timeout.
/// </summary>
public class PushToTalkRegistry
{
    private readonly ConcurrentDictionary<string, (int CarId, string SessionId)> _talkers = new();

    public void Set(string connectionId, int carId, string sessionId) => _talkers[connectionId] = (carId, sessionId);

    public bool TryRemove(string connectionId, out int carId, out string sessionId)
    {
        if (_talkers.TryRemove(connectionId, out var talker))
        {
            (carId, sessionId) = talker;
            return true;
        }
        carId = 0;
        sessionId = string.Empty;
        return false;
    }
}
