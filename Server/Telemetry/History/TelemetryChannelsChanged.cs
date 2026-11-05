namespace SignalRC.Server.Telemetry.History;

/// <summary>
/// Tells the recorder and the relay that the telemetry channels of a vehicle
/// changed (data type, unit, rename, delete, template). Without it a changed
/// data type would only take effect at the next onboard connect: a channel
/// switched from text to number kept being recorded as text.
/// </summary>
public sealed class TelemetryChannelsChanged(TelemetryRecorder recorder, TelemetryRelay relay, ILogger<TelemetryChannelsChanged> logger)
{
    public async Task NotifyAsync(int carId)
    {
        try
        {
            var ids = await recorder.RefreshAsync(carId);
            await relay.SetRecordedAsync(carId, ids);
        }
        catch (Exception ex)
        {
            // The channel change itself is saved; the history catches up at the next connect.
            logger.LogWarning(ex, "Telemetry history could not pick up the channel change of car {CarId}", carId);
        }
    }
}
