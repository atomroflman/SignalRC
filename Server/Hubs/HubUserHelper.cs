using System.Security.Claims;
using LteCar.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace LteCar.Server.Hubs;

public static class HubUserHelper
{
    public static async Task<User?> GetUserAsync(HttpContext httpContext, LteCarContext db)
    {
        if (httpContext.User.Identity is not ClaimsIdentity claimsIdentity)
            return null;

        var sessionString = claimsIdentity.Claims
            .FirstOrDefault(c => c.Type == ClaimTypes.NameIdentifier)?.Value;
        if (string.IsNullOrEmpty(sessionString))
            return null;

        var idEncoder = httpContext.RequestServices.GetRequiredService<Sqids.SqidsEncoder<long>>();
        var sessionId = idEncoder.Decode(sessionString).FirstOrDefault();
        return await db.Users.FirstOrDefaultAsync(u => u.SessionId == sessionId);
    }
}
