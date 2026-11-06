using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;

namespace SignalRC.Server.Security;

/// <summary>
/// Who may do what with a vehicle (Docs/VehicleKeyAuth.md). Both rights rest on a
/// signature of the owner key; there is no other user login.
/// <list type="bullet">
/// <item>Drive: the caller holds the control session the onboard issued
/// (AquireCarControl), announced as driver of the connected vehicle.</item>
/// <item>Configure: drive, or a config session (owner key checked by the server
/// against the stored owner public key, works offline).</item>
/// </list>
/// </summary>
public sealed class VehicleAccess(SignalRCContext db, CarConnectionStore connections, ConfigSessionStore sessions)
{
    /// <summary>The session user who holds control of the connected vehicle (D73).</summary>
    public bool IsDriver(User? user, int carId) =>
        user != null
        && connections.TryGetValue(carId.ToString(), out var info)
        && !string.IsNullOrEmpty(info.ConnectionId)
        && info.ControlSessionHash != null
        && info.DriverId == user.Id.ToString();

    /// <summary>A live config session for the vehicle in this request's cookie.</summary>
    public async Task<bool> HasConfigSessionAsync(HttpContext http, int carId)
    {
        var token = http.Request.Cookies[ConfigSessionStore.CookieName(carId)];
        if (string.IsNullOrEmpty(token)) return false;
        var fingerprint = await db.Cars.Where(c => c.Id == carId).Select(c => c.OwnerKeyFingerprint).FirstOrDefaultAsync();
        return sessions.IsValid(carId, token, fingerprint);
    }

    public async Task<bool> CanConfigureAsync(HttpContext http, int carId)
    {
        if (IsDriver(await HubUserHelper.GetUserAsync(http, db), carId)) return true;
        return await HasConfigSessionAsync(http, carId);
    }

    public async Task<bool> CanDriveAsync(HttpContext http, int carId) =>
        IsDriver(await HubUserHelper.GetUserAsync(http, db), carId);
}

/// <summary>What a vehicle endpoint needs.</summary>
public enum VehicleRight
{
    Configure,
    Drive,
}

/// <summary>
/// Endpoint filter: the route value <c>carId</c> names the vehicle; without the
/// right the request ends with 403 before the action runs.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class RequireVehicleAttribute(VehicleRight right = VehicleRight.Configure) : Attribute, IAsyncActionFilter
{
    public VehicleRight Right { get; } = right;

    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        // A method-level attribute overrides the class-level one.
        var effective = context.ActionDescriptor.FilterDescriptors
            .Select(f => f.Filter).OfType<RequireVehicleAttribute>().LastOrDefault();
        if (effective != null && !ReferenceEquals(effective, this))
        {
            await next();
            return;
        }
        if (context.ActionDescriptor.EndpointMetadata.OfType<AllowWithoutVehicleSessionAttribute>().Any())
        {
            await next();
            return;
        }

        if (!TryGetCarId(context, out var carId))
        {
            context.Result = new BadRequestObjectResult("Vehicle id missing.");
            return;
        }
        var access = context.HttpContext.RequestServices.GetRequiredService<VehicleAccess>();
        var allowed = Right == VehicleRight.Drive
            ? await access.CanDriveAsync(context.HttpContext, carId)
            : await access.CanConfigureAsync(context.HttpContext, carId);
        if (!allowed)
        {
            context.Result = new ObjectResult(Right == VehicleRight.Drive
                ? "Only the driver who controls the vehicle may do this."
                : "A control or config session of this vehicle is required (sign with the vehicle key).")
            { StatusCode = StatusCodes.Status403Forbidden };
            return;
        }
        await next();
    }

    private static bool TryGetCarId(ActionExecutingContext context, out int carId)
    {
        carId = 0;
        foreach (var (key, value) in context.RouteData.Values)
            if (string.Equals(key, "carId", StringComparison.OrdinalIgnoreCase) && int.TryParse(value?.ToString(), out carId))
                return true;
        return false;
    }
}

/// <summary>
/// Marks a read that the driving view needs, inside a controller that otherwise
/// requires a vehicle session (Docs/VehicleKeyAuth.md, "Fahransicht").
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
public sealed class AllowWithoutVehicleSessionAttribute : Attribute;

/// <summary>Config session of the current request, for services that only get the user.</summary>
public interface IConfigSessionGrant
{
    bool HasConfigSession(int carId);
}

/// <summary>Reads the config session cookie of the current HTTP request.</summary>
public sealed class RequestConfigSessionGrant(IHttpContextAccessor accessor, SignalRCContext db, ConfigSessionStore sessions) : IConfigSessionGrant
{
    public bool HasConfigSession(int carId)
    {
        var http = accessor.HttpContext;
        var token = http?.Request.Cookies[ConfigSessionStore.CookieName(carId)];
        if (string.IsNullOrEmpty(token)) return false;
        var fingerprint = db.Cars.Where(c => c.Id == carId).Select(c => c.OwnerKeyFingerprint).FirstOrDefault();
        return sessions.IsValid(carId, token, fingerprint);
    }
}
