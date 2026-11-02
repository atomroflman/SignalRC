namespace SignalRC.Server.Telemetry;

/// <summary>
/// After a SignalR reconnect the driver's browser has a new connection id while
/// its control session stays valid on the onboard (commands carry the session,
/// not the connection). The control display relay (D57) only accepts the
/// connection that acquired control, so the new connection proves the session
/// and becomes the driver connection again; the old one loses the role.
/// Vehicle commands are not affected: UpdateChannel keeps its onboard check.
/// </summary>
public static class ControlDisplayResume
{
    /// <returns>False when <paramref name="sessionId"/> is not the vehicle's current control session.</returns>
    public static async Task<bool> TryResumeAsync(CarConnectionStore store, ControlDisplayRelay relay, int carId, string? sessionId, string connectionId)
    {
        if (!store.IsControlSession(carId.ToString(), sessionId)) return false;
        // New epoch: viewers drop values of the old connection, the new one gets CtlDemand.
        await relay.ControlAcquiredAsync(carId, connectionId);
        return true;
    }
}
