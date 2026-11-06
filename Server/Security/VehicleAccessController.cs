using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Shared.Security;

namespace SignalRC.Server.Security;

/// <summary>
/// Rights of the caller on a vehicle and the config session (Docs/VehicleKeyAuth.md).
/// A config session is opened by signing a server nonce with the owner key; the server
/// checks it against the owner public key the vehicle reported, so this works while the
/// vehicle is offline.
/// </summary>
[ApiController]
[Route("api/cars/{carId:int}")]
public sealed class VehicleAccessController(
    SignalRCContext context,
    VehicleAccess access,
    ConfigSessionStore sessions,
    NonceStore nonces,
    CarConnectionStore connections,
    ILogger<VehicleAccessController> logger) : Controllers.ControllerBase(context)
{
    public sealed class ConfigSessionRequest
    {
        public string Nonce { get; set; } = "";
        public string Signature { get; set; } = "";
    }

    [HttpGet("access")]
    public async Task<IActionResult> GetAccess(int carId)
    {
        var car = await _context.Cars.AsNoTracking().Where(c => c.Id == carId)
            .Select(c => new { c.OwnerKeyFingerprint, HasDevice = c.DevicePublicKey != null })
            .FirstOrDefaultAsync();
        if (car == null) return NotFound();
        var drive = await access.CanDriveAsync(HttpContext, carId);
        var configSession = await access.HasConfigSessionAsync(HttpContext, carId);
        Response.Headers.CacheControl = "no-store";
        return Ok(new
        {
            drive,
            configure = drive || configSession,
            configSession,
            expiresAt = configSession ? sessions.ExpiresAt(carId, Request.Cookies[ConfigSessionStore.CookieName(carId)]) : null,
            // Without a reported owner key only the control session (vehicle online) grants configuring.
            ownerKeyKnown = car.OwnerKeyFingerprint != null,
            ownerKeyFingerprint = car.OwnerKeyFingerprint,
            deviceKeyKnown = car.HasDevice,
            vehicleState = connections.ContainsKey(carId.ToString())
                ? VehicleAuthState.Authenticated
                : connections.UpdateModeOfCar(carId)?.State,
        });
    }

    [HttpPost("config-session/nonce")]
    public async Task<IActionResult> IssueNonce(int carId)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        if (!await _context.Cars.AnyAsync(c => c.Id == carId)) return NotFound();
        Response.Headers.CacheControl = "no-store";
        return Ok(new { nonce = nonces.Issue(Scope(carId, user.Id)) });
    }

    [HttpPost("config-session")]
    public async Task<IActionResult> Open(int carId, [FromBody] ConfigSessionRequest body)
    {
        var user = await GetCurrentUserAsync();
        if (user == null) return Unauthorized();
        var car = await _context.Cars.AsNoTracking().FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null) return NotFound();
        if (car.OwnerPublicKey == null || car.OwnerKeyFingerprint == null)
            return Conflict("The vehicle has not reported its owner key yet; take control while it is online.");
        if (!nonces.TryConsume(body.Nonce, Scope(carId, user.Id))
            || !VehicleKeys.VerifyOwnerSignature(car.OwnerPublicKey, body.Nonce, body.Signature))
        {
            logger.LogWarning("Config session for car {CarId} refused for user {UserId}: invalid or reused signature", carId, user.Id);
            return StatusCode(StatusCodes.Status403Forbidden, "Signature does not match the vehicle key.");
        }

        sessions.Revoke(Request.Cookies[ConfigSessionStore.CookieName(carId)]);
        var token = sessions.Create(carId, car.OwnerKeyFingerprint);
        Response.Cookies.Append(ConfigSessionStore.CookieName(carId), token, new CookieOptions
        {
            HttpOnly = true,
            Secure = Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            Path = "/",
            IsEssential = true,
            // No expiry: a session cookie, gone when the browser closes; the server ends it after 2 h idle.
        });
        logger.LogInformation("Config session opened for car {CarId} by user {UserId}", carId, user.Id);
        return Ok(new { expiresAt = sessions.ExpiresAt(carId, token) });
    }

    [HttpDelete("config-session")]
    public IActionResult Close(int carId)
    {
        var name = ConfigSessionStore.CookieName(carId);
        sessions.Revoke(Request.Cookies[name]);
        Response.Cookies.Delete(name, new CookieOptions { Path = "/", SameSite = SameSiteMode.Strict, Secure = Request.IsHttps, HttpOnly = true });
        return NoContent();
    }

    private static string Scope(int carId, int userId) => $"config:{carId}:{userId}";
}
