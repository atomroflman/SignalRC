using SignalRC.Shared.Update;

namespace SignalRC.Server.Hubs;

// Onboard self-update (Docs/OnboardAutoUpdate.md): the onboard reports where its update
// stands, a driver asks for "update now".
public partial class CarConnectionHub
{
    public async Task ReportOnboardUpdateStatus(OnboardUpdateStatus status)
    {
        if (!_connectionStore.TryGetCarId(Context.ConnectionId, out var carId)
            || !_connectionStore.TryGetValue(carId.ToString(), out var info))
        {
            // Update mode: the self-update is exactly what this connection is still for.
            if (TryGetUpdateModeCar(out var updateCar, out var entry))
            {
                entry.UpdateStatus = status;
                Logger.LogInformation("Car {CarId} (update mode) update status {State} (target {Commit})", updateCar, status.State, status.TargetCommit ?? "-");
                await Clients.All.OnboardUpdateStatusChanged(updateCar, status);
                return;
            }
            Logger.LogWarning("ReportOnboardUpdateStatus received without an active car connection");
            return;
        }
        info.UpdateStatus = status;
        // Download progress comes every 5 %; only state changes belong in the log.
        Logger.Log(status.State == OnboardUpdateStatus.Downloading ? LogLevel.Debug : LogLevel.Information,
            "Car {CarId} update status {State} (target {Commit}): {Message}",
            carId, status.State, status.TargetCommit ?? "-", status.Message ?? "");
        await Clients.All.OnboardUpdateStatusChanged(carId, status);
    }

    public async Task<OnboardUpdateRequestResult> RequestOnboardUpdate(int carId, string sessionId)
    {
        var key = carId.ToString();
        if (!_connectionStore.TryGetValue(key, out var info) || string.IsNullOrEmpty(info.ConnectionId))
            return OnboardUpdateRequestResult.Refuse("Fahrzeug ist nicht verbunden.");
        // Checked here and again on the onboard: only the driver holding the SSH-authenticated session.
        if (!_connectionStore.IsControlSession(key, sessionId))
        {
            Logger.LogWarning("RequestOnboardUpdate for car {CarId} without the current control session", carId);
            return OnboardUpdateRequestResult.Refuse("Nur der Fahrer mit aktiver Steuersitzung kann das Update starten.");
        }

        Logger.LogInformation("Forwarding update request for car {CarId} by {User}", carId, Context.User?.Identity?.Name);
        var result = await Clients.Client(info.ConnectionId).StartOnboardUpdate(sessionId);
        return result ?? OnboardUpdateRequestResult.Refuse("Das Onboard hat nicht geantwortet.");
    }
}
