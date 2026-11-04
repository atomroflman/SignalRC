using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Overlay;
using SignalRC.Server.Telemetry;

namespace SignalRC.Server.Hubs;

// D75: a viewer clicks a public HUD element. The server takes input and value
// from the published document (HudInputs) and forwards the action to the
// connection that holds control; that browser runs the flow. The driver's own
// clicks never come here.
public partial class CarConnectionHub
{
    public async Task<bool> HudInput(int carId, string elementId, string? part, string action, double value)
    {
        if (!Service<HudInputRateLimit>().Allow(Context.ConnectionId)) return false;
        if (!await Service<OverlayAccess>().CanViewCarAsync(carId)) throw new HubException("Vehicle not found.");
        var driver = Service<ControlDisplayRelay>().DriverConnection(carId);
        if (driver == null) return false;
        var command = HudInputs.Resolve(await Service<OverlayService>().PublishedDocumentAsync(carId), elementId, part, action, value);
        if (command == null)
        {
            Logger.LogDebug("HUD input refused for car {CarId}: {Element}/{Part} {Action}", carId, elementId, part, action);
            return false;
        }
        await Service<IHubContext<CarConnectionHub>>().Clients.Client(driver)
            .SendAsync("HudInput", carId, command.Input, command.Action, command.Value);
        return true;
    }
}
