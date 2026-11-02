using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Server.Overlay;

public enum OverlayAccessError
{
    None,
    LoginRequired,
    NoCarAccess,
    NotDriver,
}

/// <summary>
/// The two overlay roles (Shared/Overlay/api/README.md §1). Every management
/// request is checked anew; nothing is cached per session.
/// </summary>
public sealed class OverlayAccess(SignalRCContext db)
{
    /// <summary>
    /// Whoever may see the vehicle's streams. Streams have no read check today,
    /// so this is every client; tightening it here tightens all overlay reads.
    /// </summary>
    public Task<bool> CanViewCarAsync(int carId) => db.Cars.AnyAsync(c => c.Id == carId);

    /// <summary>Regular login, access to the vehicle and active control of it.</summary>
    public async Task<OverlayAccessError> CheckAdminAsync(User? user, int carId)
    {
        if (user == null || string.IsNullOrWhiteSpace(user.LoginName))
        {
            return OverlayAccessError.LoginRequired;
        }
        if (!await db.UserSetups.AnyAsync(setup => setup.UserId == user.Id && setup.CarId == carId))
        {
            return OverlayAccessError.NoCarAccess;
        }
        return user.ActiveVehicleId == carId ? OverlayAccessError.None : OverlayAccessError.NotDriver;
    }
}
