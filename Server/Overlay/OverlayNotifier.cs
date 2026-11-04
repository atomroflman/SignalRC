using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Hubs;

namespace SignalRC.Server.Overlay;

/// <summary>Overlay events on CarConnectionHub (Shared/Overlay/api/README.md §4).</summary>
public interface IOverlayNotifier
{
    Task DraftChangedAsync(int carId, long revision);
    Task PublishedAsync(int carId, int publicationId, int number);
}

public sealed class HubOverlayNotifier(IHubContext<CarConnectionHub> hub) : IOverlayNotifier
{
    public static string Group(int carId) => $"overlay:{carId}";

    // Revision numbers only: no content and no user data go to viewers.
    public Task DraftChangedAsync(int carId, long revision) =>
        hub.Clients.Group(Group(carId)).SendAsync("OverlayDraftChanged", new { carId, revision });

    public Task PublishedAsync(int carId, int publicationId, int number) =>
        hub.Clients.Group(Group(carId)).SendAsync("OverlayPublished", new { carId, publicationId, number });
}
