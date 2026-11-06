using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Shared.Flow;
using SignalRC.Shared.HubClients;

namespace SignalRC.Server.Services;

/// <summary>
/// Pushes the onboard part of the session holder's flow to the vehicle (E04, E09, T06):
/// right after a driver takes control, and after every change of their flow (debounced).
/// Keeps who holds control per vehicle, since only the server knows the user of a session.
/// </summary>
public sealed class OnboardFlowPublisher
{
    public static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(250);

    private sealed record Holder(int UserId, string SessionId);

    private readonly IServiceScopeFactory _scopes;
    private readonly IHubContext<CarConnectionHub, IConnectionHubClient> _hub;
    private readonly CarConnectionStore _connections;
    private readonly ILogger<OnboardFlowPublisher> _logger;
    private readonly ConcurrentDictionary<int, Holder> _holders = new();
    private readonly ConcurrentDictionary<int, CancellationTokenSource> _pending = new();

    public OnboardFlowPublisher(IServiceScopeFactory scopes, IHubContext<CarConnectionHub, IConnectionHubClient> hub, CarConnectionStore connections, ILogger<OnboardFlowPublisher> logger)
    {
        _scopes = scopes;
        _hub = hub;
        _connections = connections;
        _logger = logger;
    }

    /// <summary>A driver took control: push their onboard flow now (or switch it off).</summary>
    public Task ControlAcquiredAsync(int carId, int userId, string sessionId)
    {
        _holders[carId] = new Holder(userId, sessionId);
        return PushAsync(carId);
    }

    public void ControlReleased(int carId, string sessionId)
    {
        if (_holders.TryGetValue(carId, out var holder) && holder.SessionId == sessionId)
            _holders.TryRemove(carId, out _);
    }

    /// <summary>The user holding control of this vehicle, if known.</summary>
    public int? HolderOf(int carId) => _holders.TryGetValue(carId, out var h) ? h.UserId : null;

    /// <summary>A flow changed: if its owner holds control of the vehicle, push again after a short pause.</summary>
    public void FlowChanged(int carId, int userId)
    {
        if (!_holders.TryGetValue(carId, out var holder) || holder.UserId != userId) return;
        var cts = new CancellationTokenSource();
        var previous = _pending.AddOrUpdate(carId, cts, (_, old) => { old.Cancel(); return cts; });
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(Debounce, cts.Token);
                _pending.TryRemove(new KeyValuePair<int, CancellationTokenSource>(carId, cts));
                await PushAsync(carId);
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Pushing the onboard flow of car {CarId} failed.", carId);
            }
        });
    }

    private async Task PushAsync(int carId)
    {
        if (!_holders.TryGetValue(carId, out var holder)) return;
        if (!_connections.TryGetValue(carId.ToString(), out var connection) || connection.ConnectionId == null) return;

        OnboardFlowDefinition? definition;
        using (var scope = _scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
            var setupId = db.UserSetups.Where(s => s.CarId == carId && s.UserId == holder.UserId).Select(s => (int?)s.Id).FirstOrDefault();
            definition = setupId is { } id ? await OnboardFlowBuilder.BuildAsync(db, id) : null;
        }
        await _hub.Clients.Client(connection.ConnectionId).ApplyOnboardFlow(holder.SessionId, definition);
        _logger.LogInformation("Onboard flow for car {CarId} (user {UserId}): {State}", carId, holder.UserId,
            definition == null ? "none" : $"{definition.Nodes.Count} nodes, {definition.Hash[..8]}");
    }
}
