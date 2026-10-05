using System.Collections.Concurrent;
using LteCar.Shared.Channels;

namespace LteCar.Server.Services;

// ponytail: in-memory per-car cache of the ControlType/TelemetryType strings
// the Onboard has registered. Not persisted: if the Server restarts, the
// Onboard re-registers on next connect. Browser always reads via REST
// (the SignalR push goes Server-side only, not Browser-bound).
public class AvailableTypesRegistry
{
    private readonly ConcurrentDictionary<int, AvailableChannelTypes> _types = new();

    public void Set(int carId, AvailableChannelTypes types)
    {
        _types[carId] = types;
    }

    public AvailableChannelTypes? Get(int carId)
    {
        return _types.TryGetValue(carId, out var t) ? t : null;
    }
}
