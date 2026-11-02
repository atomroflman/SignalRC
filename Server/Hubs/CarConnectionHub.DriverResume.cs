using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Telemetry;

namespace SignalRC.Server.Hubs;

// AP13: the driver's browser rebinds its control display connection after a
// SignalR reconnect (ControlDisplayResume); no new acquisition needed.
public partial class CarConnectionHub
{
    public Task<bool> ResumeCarControl(int carId, string sessionId)
    {
        var relay = Context.GetHttpContext()!.RequestServices.GetRequiredService<ControlDisplayRelay>();
        return ControlDisplayResume.TryResumeAsync(_connectionStore, relay, carId, sessionId, Context.ConnectionId);
    }
}
