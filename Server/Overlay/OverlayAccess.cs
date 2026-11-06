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
public sealed class OverlayAccess(SignalRCContext db, CarConnectionStore connections, Security.IConfigSessionGrant? configSessions = null)
{
    /// <summary>
    /// Whoever may see the vehicle's streams. Streams have no read check today,
    /// so this is every client; tightening it here tightens all overlay reads.
    /// </summary>
    public Task<bool> CanViewCarAsync(int carId) => db.Cars.AnyAsync(c => c.Id == carId);

    /// <summary>
    /// Management (Docs/VehicleKeyAuth.md): the driver (D73, control session of the
    /// connected vehicle) or a config session of the vehicle, which also works while
    /// it is offline. Both rest on a signature of the owner key; no login, no user setup.
    /// </summary>
    public Task<OverlayAccessError> CheckAdminAsync(User? user, int carId) => Task.FromResult(CheckAdmin(user, carId));

    public OverlayAccessError CheckAdmin(User? user, int carId)
    {
        if (CheckDriver(user, carId) == OverlayAccessError.None) return OverlayAccessError.None;
        if (configSessions?.HasConfigSession(carId) == true) return OverlayAccessError.None;
        return user == null ? OverlayAccessError.SessionRequired : OverlayAccessError.NotDriver;
    }

    /// <summary>Only the session user who holds control of the connected vehicle (driving functions).</summary>
    public OverlayAccessError CheckDriver(User? user, int carId)
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
