using System.Collections.Concurrent;
using System.Threading;

namespace LteCar.Server.Services;

public class ActiveVideoStreamViewerRegistry
{
    private readonly ConcurrentDictionary<int, ConcurrentDictionary<string, byte>> _streamViewers = new();
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<int, byte>> _connectionStreams = new();
    private readonly ConcurrentDictionary<int, ViewerCounter> _viewerCounts = new();

    public bool Activate(string connectionId, int streamId)
    {
        var streams = _connectionStreams.GetOrAdd(connectionId, _ => new ConcurrentDictionary<int, byte>());
        if (!streams.TryAdd(streamId, 0))
        {
            return false;
        }

        var viewers = _streamViewers.GetOrAdd(streamId, _ => new ConcurrentDictionary<string, byte>());
        viewers.TryAdd(connectionId, 0);

        var counter = _viewerCounts.GetOrAdd(streamId, _ => new ViewerCounter());
        return Interlocked.Increment(ref counter.Count) == 1;
    }

    public bool Deactivate(string connectionId, int streamId)
    {
        if (!_connectionStreams.TryGetValue(connectionId, out var streams) || !streams.TryRemove(streamId, out _))
        {
            return false;
        }

        if (_streamViewers.TryGetValue(streamId, out var viewers))
        {
            viewers.TryRemove(connectionId, out _);
        }

        return DecrementViewerCount(streamId) == 0;
    }

    public IReadOnlyList<int> RemoveConnection(string connectionId)
    {
        if (!_connectionStreams.TryRemove(connectionId, out var streams))
        {
            return [];
        }

        var stoppedStreams = new List<int>();
        foreach (var streamId in streams.Keys)
        {
            if (_streamViewers.TryGetValue(streamId, out var viewers))
            {
                viewers.TryRemove(connectionId, out _);
            }

            if (DecrementViewerCount(streamId) == 0)
            {
                stoppedStreams.Add(streamId);
            }
        }

        return stoppedStreams;
    }

    public bool ClearStream(int streamId)
    {
        if (!_streamViewers.TryRemove(streamId, out var viewers))
        {
            return false;
        }

        foreach (var connectionId in viewers.Keys)
        {
            if (_connectionStreams.TryGetValue(connectionId, out var streams))
            {
                streams.TryRemove(streamId, out _);
            }
        }

        if (_viewerCounts.TryGetValue(streamId, out var counter))
        {
            Interlocked.Exchange(ref counter.Count, 0);
        }

        return true;
    }

    public int GetViewerCount(int streamId)
    {
        return _viewerCounts.TryGetValue(streamId, out var counter)
            ? Math.Max(0, Volatile.Read(ref counter.Count))
            : 0;
    }

    private int DecrementViewerCount(int streamId)
    {
        if (!_viewerCounts.TryGetValue(streamId, out var counter))
        {
            return 0;
        }

        var remainingViewers = Interlocked.Decrement(ref counter.Count);
        if (remainingViewers >= 0)
        {
            return remainingViewers;
        }

        Interlocked.Exchange(ref counter.Count, 0);
        return 0;
    }

    private sealed class ViewerCounter
    {
        public int Count;
    }
}