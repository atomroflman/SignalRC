using System.Collections.Concurrent;

namespace SignalRC.Server.Services;

/// <summary>
/// Server-side bookkeeping for two-way vehicle audio.
/// <list type="bullet">
/// <item>Listen (vehicle → browser): one audio-only Janus mountpoint per car, created for the first
/// listener and destroyed when the last one leaves. The vehicle sends Opus/RTP to its port.</item>
/// <item>Talk (browser → vehicle): remembers which connection is currently pushing audio so a
/// dropped browser can stop the vehicle speaker immediately.</item>
/// </list>
/// </summary>
public class VehicleAudioService
{
    // Video mountpoints use the CarVideoStream DB id; keep audio well clear of that range.
    private const uint MountpointOffset = 1_000_000;

    private readonly VideoStreamReceiverService _janus;
    private readonly ILogger<VehicleAudioService> _logger;
    private readonly SemaphoreSlim _lock = new(1, 1);
    private readonly Dictionary<int, CarAudioState> _cars = new();
    private readonly ConcurrentDictionary<string, (int CarId, string SessionId)> _talkers = new();

    public VehicleAudioService(VideoStreamReceiverService janus, ILogger<VehicleAudioService> logger)
    {
        _janus = janus;
        _logger = logger;
    }

    public static uint MountpointId(int carId) => MountpointOffset + (uint)carId;

    /// <summary>
    /// Registers a listener and makes sure the car's Janus audio mountpoint exists.
    /// Returns the RTP port the vehicle has to send to.
    /// </summary>
    public async Task<int> AddListenerAsync(int carId, string connectionId, string sessionId, string description)
    {
        await _lock.WaitAsync();
        try
        {
            if (!_cars.TryGetValue(carId, out var state))
            {
                var port = _janus.ReservePort();
                try
                {
                    await _janus.OpenJanusAudioEndpointAsync(MountpointId(carId), description, port);
                }
                catch
                {
                    _janus.ReleasePort(port);
                    throw;
                }
                state = new CarAudioState(port);
                _cars[carId] = state;
                _logger.LogInformation("Opened audio mountpoint {MountpointId} for car {CarId} on UDP port {Port}", MountpointId(carId), carId, port);
            }
            state.Listeners.Add(connectionId);
            state.SessionId = sessionId;
            return state.Port;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Removes a listener. Returns true when it was the last one and the mountpoint was torn down,
    /// i.e. the vehicle should stop its uplink.
    /// </summary>
    public async Task<bool> RemoveListenerAsync(int carId, string connectionId)
    {
        await _lock.WaitAsync();
        try
        {
            if (!_cars.TryGetValue(carId, out var state) || !state.Listeners.Remove(connectionId))
                return false;
            if (state.Listeners.Count > 0)
                return false;
            _cars.Remove(carId);
            await TearDownAsync(carId, state);
            return true;
        }
        finally
        {
            _lock.Release();
        }
    }

    /// <summary>
    /// Drops a disconnected browser from all cars. Returns the cars whose last listener left.
    /// </summary>
    public async Task<IReadOnlyList<int>> RemoveConnectionAsync(string connectionId)
    {
        var stopped = new List<int>();
        await _lock.WaitAsync();
        try
        {
            foreach (var (carId, state) in _cars.ToList())
            {
                if (!state.Listeners.Remove(connectionId) || state.Listeners.Count > 0)
                    continue;
                _cars.Remove(carId);
                await TearDownAsync(carId, state);
                stopped.Add(carId);
            }
        }
        finally
        {
            _lock.Release();
        }
        return stopped;
    }

    /// <summary>
    /// Used when a vehicle reconnects: if someone is still listening, the uplink must be restarted.
    /// </summary>
    public bool TryGetActiveUplink(int carId, out int port, out string sessionId)
    {
        _lock.Wait();
        try
        {
            if (_cars.TryGetValue(carId, out var state) && state.SessionId != null)
            {
                port = state.Port;
                sessionId = state.SessionId;
                return true;
            }
        }
        finally
        {
            _lock.Release();
        }
        port = 0;
        sessionId = string.Empty;
        return false;
    }

    public void SetTalker(string connectionId, int carId, string sessionId) => _talkers[connectionId] = (carId, sessionId);

    public bool TryRemoveTalker(string connectionId, out int carId, out string sessionId)
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

    private async Task TearDownAsync(int carId, CarAudioState state)
    {
        try
        {
            await _janus.DestroyJanusMountpointAsync((int)MountpointId(carId));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to destroy audio mountpoint for car {CarId}", carId);
        }
        _janus.ReleasePort(state.Port);
        _logger.LogInformation("Closed audio mountpoint for car {CarId}", carId);
    }

    private sealed class CarAudioState(int port)
    {
        public int Port { get; } = port;
        public HashSet<string> Listeners { get; } = new();
        public string? SessionId { get; set; }
    }
}
