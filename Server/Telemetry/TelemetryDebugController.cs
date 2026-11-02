using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;

namespace SignalRC.Server.Telemetry;

/// <summary>GET telemetry-debug (Shared/Overlay/api/README.md §3), overlay administrator only (D73).</summary>
[ApiController]
[Route("api/cars/{carId:int}/overlay/telemetry-debug")]
public class TelemetryDebugController(SignalRCContext context, OverlayAccess access, TelemetryRelay relay) : Controllers.ControllerBase(context)
{
    [HttpGet]
    public async Task<IActionResult> Get(int carId)
    {
        var result = await new TelemetryDebugService(_context, access, relay).GetAsync(carId, await GetCurrentUserAsync());
        Response.Headers.CacheControl = "no-store";
        if (result.Error is { } error)
        {
            var body = new JsonObject { ["type"] = "about:blank", ["title"] = error.Title, ["status"] = error.Status, ["code"] = error.Code };
            var problem = new ObjectResult(body) { StatusCode = error.Status };
            problem.ContentTypes.Add("application/problem+json");
            return problem;
        }
        return Ok(result.Value);
    }
}
