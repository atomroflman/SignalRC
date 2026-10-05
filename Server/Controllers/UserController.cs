using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using System;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using LteCar.Server.Data;
using System.Security.Cryptography;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace LteCar.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class UserController : ControllerBase
{
    private readonly LteCarContext DbContext;
    private readonly IServiceProvider ServiceProvider;
    private readonly ILogger<UserController> Logger;
    private static readonly TimeSpan CodeValidity = TimeSpan.FromMinutes(5);

    public UserController(LteCarContext context, IServiceProvider serviceProvider, ILogger<UserController> logger) : base(context)
    {
        DbContext = context;
        ServiceProvider = serviceProvider;
        Logger = logger;
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        string? sessionToken = null;
        if (User.Identity?.IsAuthenticated == true)
        {
            sessionToken = User.FindFirstValue(ClaimTypes.NameIdentifier);
        }

        var idEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();

        if (!string.IsNullOrEmpty(sessionToken))
        {
            var sessionId = idEncoder.Decode(sessionToken).FirstOrDefault();
            var user = await DbContext.Users.FirstOrDefaultAsync(u => u.SessionId == sessionId);

            if (user != null)
            {
                user.LastSeen = DateTime.UtcNow;
                await DbContext.SaveChangesAsync();
                return Ok(new
                {
                    authenticated = true,
                    userId = user.Id,
                    sessionToken,
                    userName = user.Name,
                    hasControlledCar = user.HasControlledCar,
                    loginName = user.LoginName,
                    recoveryKey = (string?)null
                });
            }

            Logger.LogWarning("Session token exists but user not found in DB. SessionId: {SessionId}", sessionId);
        }

        var nextSessionId = await DbContext.GetNextUserSessionId();
        var newSessionToken = idEncoder.Encode(nextSessionId);

        var newUser = new User
        {
            LastSeen = DateTime.UtcNow,
            SessionId = nextSessionId,
            Name = $"User_{nextSessionId}"
        };
        DbContext.Users.Add(newUser);
        var recoveryKey = await EnsureAndStoreRecoveryKeyAsync(newUser);

        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, newSessionToken) };
        var identity = new ClaimsIdentity(claims, "cookie");
        var principal = new ClaimsPrincipal(identity);

        await HttpContext.SignInAsync("cookie", principal);

        return Ok(new
        {
            authenticated = true,
            userId = newUser.Id,
            sessionToken = newSessionToken,
            userName = newUser.Name,
            hasControlledCar = newUser.HasControlledCar,
            loginName = newUser.LoginName,
            recoveryKey
        });
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest model)
    {
        if (string.IsNullOrWhiteSpace(model.UserName) || string.IsNullOrWhiteSpace(model.Password))
        {
            return BadRequest(new { message = "Username and password are required" });
        }

        var existingUser = await DbContext.Users
            .FirstOrDefaultAsync(u => u.LoginName == model.UserName || u.Name == model.UserName);

        if (existingUser != null && existingUser.PasswordHash != null)
        {
            if (!existingUser.ValidatePassword(model.Password))
            {
                return Unauthorized(new { message = "Invalid password" });
            }

            existingUser.LastSeen = DateTime.UtcNow;
            existingUser.LastLogin = DateTime.UtcNow;
            await DbContext.SaveChangesAsync();

            var idEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();
            var sessionToken = idEncoder.Encode(existingUser.SessionId);

            var claims = new[] { new Claim(ClaimTypes.NameIdentifier, sessionToken) };
            var identity = new ClaimsIdentity(claims, "cookie");
            var principal = new ClaimsPrincipal(identity);
            await HttpContext.SignInAsync("cookie", principal);

            return Ok(new
            {
                authenticated = true,
                userId = existingUser.Id,
                sessionToken,
                userName = existingUser.Name,
                hasControlledCar = existingUser.HasControlledCar,
                loginName = existingUser.LoginName,
                recoveryKey = (string?)null
            });
        }

        var nextSessionId = await DbContext.GetNextUserSessionId();
        var newUser = new User
        {
            LastSeen = DateTime.UtcNow,
            LastLogin = DateTime.UtcNow,
            SessionId = nextSessionId,
            Name = model.UserName,
            LoginName = model.UserName
        };
        newUser.SetPassword(model.Password);

        DbContext.Users.Add(newUser);
        var recoveryKey = await EnsureAndStoreRecoveryKeyAsync(newUser);

        var newIdEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();
        var newSessionToken = newIdEncoder.Encode(newUser.SessionId);

        var newClaims = new[] { new Claim(ClaimTypes.NameIdentifier, newSessionToken) };
        var newIdentity = new ClaimsIdentity(newClaims, "cookie");
        var newPrincipal = new ClaimsPrincipal(newIdentity);
        await HttpContext.SignInAsync("cookie", newPrincipal);

        return Ok(new
        {
            authenticated = true,
            userId = newUser.Id,
            sessionToken = newSessionToken,
            userName = newUser.Name,
            hasControlledCar = newUser.HasControlledCar,
            loginName = newUser.LoginName,
            recoveryKey
        });
    }

    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync("cookie");
        return Ok(new { message = "Logged out successfully" });
    }

    [HttpPost("recover-session")]
    public async Task<IActionResult> RecoverSession([FromBody] RecoverSessionRequest model)
    {
        if (string.IsNullOrWhiteSpace(model.RecoveryKey))
        {
            return BadRequest(new { message = "Recovery key is required" });
        }

        var normalized = LteCar.Server.Data.User.NormalizeRecoveryKey(model.RecoveryKey);
        if (normalized.Length != 16)
        {
            return Unauthorized(new { message = "Invalid recovery key" });
        }

        using var sha256 = System.Security.Cryptography.SHA256.Create();
        var hash = Convert.ToBase64String(sha256.ComputeHash(System.Text.Encoding.UTF8.GetBytes(normalized)));

        var user = await DbContext.Users.FirstOrDefaultAsync(u => u.RecoveryKeyHash == hash);
        if (user == null)
        {
            return Unauthorized(new { message = "Invalid recovery key" });
        }

        user.LastSeen = DateTime.UtcNow;
        user.LastLogin = DateTime.UtcNow;
        await DbContext.SaveChangesAsync();

        var idEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();
        var sessionToken = idEncoder.Encode(user.SessionId);

        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, sessionToken) };
        var identity = new ClaimsIdentity(claims, "cookie");
        var principal = new ClaimsPrincipal(identity);
        await HttpContext.SignInAsync("cookie", principal);

        Logger.LogInformation("User {UserId} recovered session via recovery key", user.Id);

        return Ok(new
        {
            authenticated = true,
            userId = user.Id,
            sessionToken,
            userName = user.Name,
            hasControlledCar = user.HasControlledCar,
            loginName = user.LoginName,
            recoveryKey = (string?)null
        });
    }

    [HttpPost("regenerate-recovery-key")]
    public async Task<IActionResult> RegenerateRecoveryKey()
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized(new { message = "You must be logged in to regenerate a recovery key" });
        }

        var newKey = LteCar.Server.Data.User.GenerateRecoveryKey();
        user.SetRecoveryKey(newKey);
        await DbContext.SaveChangesAsync();

        return Ok(new { recoveryKey = newKey });
    }

    [HttpPost("claim-anonymous-session")]
    public async Task<IActionResult> ClaimAnonymousSession()
    {
        var loggedInUser = await GetCurrentUserAsync();
        if (loggedInUser == null)
        {
            return Unauthorized(new { message = "You must be logged in to claim a session" });
        }

        if (loggedInUser.LoginName != null)
        {
            return BadRequest(new { message = "Your session is already associated with a login" });
        }

        return Ok(new
        {
            message = "Session already claimed",
            userId = loggedInUser.Id,
            userName = loggedInUser.Name,
            hasControlledCar = loggedInUser.HasControlledCar,
            loginName = loggedInUser.LoginName
        });
    }

    [HttpPost("generate-transfer-code")]
    public async Task<IActionResult> GenerateTransferCode()
    {
        var user = await GetCurrentUserAsync();
        if (user == null)
        {
            return Unauthorized(new { message = "No active session found" });
        }

        var nextSessionId = await DbContext.GetNextUserSessionId();

        user.TransferCode = nextSessionId;
        user.TransferCodeExpiresAt = DateTime.UtcNow.Add(CodeValidity);
        await DbContext.SaveChangesAsync();
        var idEncoder = ServiceProvider.GetRequiredKeyedService<Sqids.SqidsEncoder<long>>("transfer");
        var transferCode = idEncoder.Encode(user.TransferCode.Value);
        return Ok(new { transferCode });
    }

    [HttpPost("apply-transfer-code")]
    public async Task<IActionResult> ApplyTransferCode([FromBody] ApplyTransferRequest model)
    {
        var code = model.TransferCode?.ToUpper().Trim();
        if (string.IsNullOrEmpty(code))
        {
            return BadRequest(new { message = "Transfer code is required" });
        }

        var transfercodeEncoder = ServiceProvider.GetRequiredKeyedService<Sqids.SqidsEncoder<long>>("transfer");
        var transferCode = transfercodeEncoder.Decode(code).FirstOrDefault();
        if (transferCode == 0)
        {
            return BadRequest(new { message = "Invalid transfer code" });
        }

        var user = await DbContext.Users.FirstOrDefaultAsync(u => u.TransferCode == transferCode && u.TransferCodeExpiresAt > DateTime.UtcNow);
        if (user == null)
        {
            return BadRequest(new { message = "Invalid transfer code" });
        }

        user.TransferCode = null;
        user.TransferCodeExpiresAt = null;

        var idEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();
        var sessionToken = idEncoder.Encode(user.SessionId);

        var claims = new[] { new Claim(ClaimTypes.NameIdentifier, sessionToken) };
        var identity = new ClaimsIdentity(claims, "cookie");
        var principal = new ClaimsPrincipal(identity);

        await HttpContext.SignInAsync("cookie", principal);

        await DbContext.SaveChangesAsync();

        return Ok(new
        {
            message = "Session transferred successfully"
        });
    }

    private new async Task<User?> GetCurrentUserAsync()
    {
        if (User.Identity?.IsAuthenticated != true)
            return null;

        var sessionToken = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrEmpty(sessionToken))
            return null;

        var idEncoder = ServiceProvider.GetRequiredService<Sqids.SqidsEncoder<long>>();
        var sessionId = idEncoder.Decode(sessionToken).FirstOrDefault();

        return await DbContext.Users.FirstOrDefaultAsync(u => u.SessionId == sessionId);
    }

    private async Task<string?> EnsureAndStoreRecoveryKeyAsync(User user)
    {
        if (!string.IsNullOrEmpty(user.RecoveryKeyHash))
            return null;

        var key = LteCar.Server.Data.User.GenerateRecoveryKey();
        user.SetRecoveryKey(key);
        await DbContext.SaveChangesAsync();
        Logger.LogInformation("Generated new recovery key for user {UserId}", user.Id);
        return key;
    }

    public class LoginRequest
    {
        public string UserName { get; set; } = string.Empty;
        public string Password { get; set; } = string.Empty;
    }

    public class ApplyTransferRequest
    {
        public string TransferCode { get; set; } = string.Empty;
    }

    public class RecoverSessionRequest
    {
        public string RecoveryKey { get; set; } = string.Empty;
    }
}
