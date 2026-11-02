using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Shared.HubClients;

namespace SignalRC.Server.Overlay.Lidar;

/// <summary>POST lidar-grid-source (Shared/Overlay/api/README.md §3, lidar/README.md §7).</summary>
[ApiController]
[Route("api/cars/{carId:int}/overlay/lidar-grid-source")]
public class LidarGridSourceController(
    SignalRCContext context,
    OverlayAccess access,
    IHubContext<CarConnectionHub, IConnectionHubClient> hub,
    ILogger<LidarGridSourceController> logger) : Controllers.ControllerBase(context)
{
    [HttpPost]
    public async Task<IActionResult> Ensure(int carId)
    {
        var user = await GetCurrentUserAsync();
        var result = await new LidarGridSourceService(_context, access).EnsureAsync(carId, user);
        if (result.Error is { } error)
        {
            var body = new JsonObject { ["type"] = "about:blank", ["title"] = error.Title, ["status"] = error.Status, ["code"] = error.Code };
            var problem = new ObjectResult(body) { StatusCode = error.Status };
            problem.ContentTypes.Add("application/problem+json");
            return problem;
        }

        var (created, channel) = result.Value!;
        if (created)
        {
            // Same push as the channel management, but with the server id so
            // the onboard can address the channel right away.
            await hub.Clients.Group($"Car-{carId}").UpsertTelemetryChannel(channel.ChannelName, LidarGridSourceService.ToMapItem(channel));
            logger.LogInformation("LiDAR grid source created for car {CarId} by {User}", carId, user!.LoginName);
        }
        return Ok(new { created });
    }
}
