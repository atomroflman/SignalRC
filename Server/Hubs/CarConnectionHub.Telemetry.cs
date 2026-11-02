using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Overlay;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Server.Hubs;

// Telemetry v1.1 and the control display (Shared/Overlay/telemetry/README.md
// §5, §7). The relays hold the state; these methods check origin and access.
public partial class CarConnectionHub
{
    private T Service<T>() where T : notnull => Context.GetHttpContext()!.RequestServices.GetRequiredService<T>();

    /// <summary>The onboard's delta. The vehicle is the one this connection opened (D56); no carId parameter.</summary>
    public async Task UpdateTelemetrySamples(TelemetryDelta delta)
    {
        if (!_connectionStore.TryGetCarId(Context.ConnectionId, out var carId))
        {
            LogRejectedTelemetry(null);
            return;
        }
        await Service<TelemetryRelay>().OnDeltaAsync(carId, delta);
    }

    public async Task SetTelemetryInterest(int carId, int[] channelIds)
    {
        if (!await Service<OverlayAccess>().CanViewCarAsync(carId)) throw new HubException("Vehicle not found.");
        await Service<TelemetryRelay>().SetInterestAsync(Context.ConnectionId, carId, channelIds);
    }

    public async Task SetControlDisplayInterest(int carId, bool interested)
    {
        if (interested && !await Service<OverlayAccess>().CanViewCarAsync(carId)) throw new HubException("Vehicle not found.");
        await Service<ControlDisplayRelay>().SetInterestAsync(Context.ConnectionId, carId, interested);
    }

    /// <summary>
    /// Display values of the driver: outputs as [channelId, value] pairs,
    /// signals as [name, value] pairs. Never forwarded to the vehicle.
    /// </summary>
    public Task Ctl(int carId, long seq, bool paused, double[][] outputs, JsonElement signals, int[] removedOutputs, string[] removedSignals)
    {
        var o = outputs.Where(p => p.Length == 2 && double.IsFinite(p[1])).Select(p => ((int)p[0], p[1])).ToList();
        var s = new List<(string, double)>();
        if (signals.ValueKind == JsonValueKind.Array)
        {
            foreach (var pair in signals.EnumerateArray())
            {
                if (pair.ValueKind == JsonValueKind.Array && pair.GetArrayLength() == 2
                    && pair[0].ValueKind == JsonValueKind.String && pair[1].ValueKind == JsonValueKind.Number
                    && double.IsFinite(pair[1].GetDouble()))
                {
                    s.Add((pair[0].GetString()!, pair[1].GetDouble()));
                }
            }
        }
        return Service<ControlDisplayRelay>().PublishAsync(Context.ConnectionId, carId, seq, paused, o, s, removedOutputs, removedSignals);
    }

    private static long _rejectedTelemetry;

    private void LogRejectedTelemetry(string? claimedCarId)
    {
        if (Interlocked.Increment(ref _rejectedTelemetry) % 100 == 1)
        {
            Logger.LogWarning("Rejected telemetry from {Connection} (claimed car {CarId}): not the registered onboard", Context.ConnectionId, claimedCarId);
        }
    }
}
