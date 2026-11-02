using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Overlay;

namespace SignalRC.Server.Hubs;

// Overlay events (Shared/Overlay/api/README.md §4): viewers join the group of
// a vehicle and receive OverlayPublished / OverlayDraftChanged.
public partial class CarConnectionHub
{
    public async Task SubscribeToOverlay(int carId)
    {
        var access = Context.GetHttpContext()!.RequestServices.GetRequiredService<OverlayAccess>();
        if (!await access.CanViewCarAsync(carId))
        {
            throw new HubException("Vehicle not found.");
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, HubOverlayNotifier.Group(carId));
    }

    public Task UnsubscribeFromOverlay(int carId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, HubOverlayNotifier.Group(carId));
}
