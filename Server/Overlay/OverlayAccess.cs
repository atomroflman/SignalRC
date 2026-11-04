using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Server.Overlay;

public enum OverlayAccessError
{
    None,
    SessionRequired,
    NotDriver,
}

/// <summary>
/// The two overlay roles (Shared/Overlay/api/README.md §1). Every management
/// request is checked anew; nothing is cached per session.
/// </summary>
public sealed class OverlayAccess(SignalRCContext db, CarConnectionStore connections)
{
    /// <summary>
    /// Whoever may see the vehicle's streams. Streams have no read check today,
    /// so this is every client; tightening it here tightens all overlay reads.
    /// </summary>
    public Task<bool> CanViewCarAsync(int carId) => db.Cars.AnyAsync(c => c.Id == carId);

    /// <summary>
    /// D73: the session user who currently holds control of the connected vehicle
    /// (driver announced by AquireCarControl). No login, no user setup.
    /// </summary>
    public Task<OverlayAccessError> CheckAdminAsync(User? user, int carId) => Task.FromResult(CheckAdmin(user, carId));

    public OverlayAccessError CheckAdmin(User? user, int carId)
    {
        if (user == null) return OverlayAccessError.SessionRequired;
        return connections.TryGetValue(carId.ToString(), out var info)
            && !string.IsNullOrEmpty(info.ConnectionId)
            && info.ControlSessionHash != null
            && info.DriverId == user.Id.ToString()
            ? OverlayAccessError.None
            : OverlayAccessError.NotDriver;
    }
}
