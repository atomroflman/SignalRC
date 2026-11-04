using SignalRC.Server.Data;
using SignalRC.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace SignalRC.Server.Controllers;

// ponytail: the forwarded onboard log for the GUI. Same access as the car's config
// (ConfigGuard): the log shows the vehicle's internals.
[ApiController]
[Route("api/cars/{carId:int}/logs")]
public class OnboardLogsController : ControllerBase
{
    private readonly OnboardLogStore _logs;

    public OnboardLogsController(SignalRCContext context, OnboardLogStore logs) : base(context)
    {
        _logs = logs;
    }

    [HttpGet]
    public async Task<IActionResult> Get(int carId, [FromQuery] long after = 0, [FromQuery] int limit = 1000)
    {
        if (!await HasAccessAsync(carId)) return Unauthorized();
        var (entries, lastSeq) = _logs.Get(carId, after, Math.Clamp(limit, 1, OnboardLogStore.Capacity));
        return Ok(new { entries, lastSeq });
    }

    [HttpDelete]
    public async Task<IActionResult> Clear(int carId)
    {
        if (!await HasAccessAsync(carId)) return Unauthorized();
        _logs.Clear(carId);
        return NoContent();
    }

    private async Task<bool> HasAccessAsync(int carId)
    {
        var user = await GetCurrentUserAsync();
        return user != null && await _context.UserSetups.AnyAsync(u => u.UserId == user.Id && u.CarId == carId);
    }
}
