using SignalRC.Server.Security;
using SignalRC.Server.Data;
using SignalRC.Server.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace SignalRC.Server.Controllers;

// ponytail: the forwarded onboard log for the GUI. Same access as the car's config
// (ConfigGuard): the log shows the vehicle's internals.
[ApiController]
[Route("api/cars/{carId:int}/logs")]
// Control or config session (Docs/VehicleKeyAuth.md); a user setup is no permission any more.
[RequireVehicle]
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
        var (entries, lastSeq) = _logs.Get(carId, after, Math.Clamp(limit, 1, OnboardLogStore.Capacity));
        return Ok(new { entries, lastSeq });
    }

    [HttpDelete]
    public async Task<IActionResult> Clear(int carId)
    {
        _logs.Clear(carId);
        return NoContent();
    }
}
