using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay;
using SignalRC.Server.Services;
using SignalRC.Shared.Flow;

namespace SignalRC.Server.Hubs;

// Onboard flow and vehicle controllers (OnboardFlow-Arbeitspakete.md OF05).
public partial class CarConnectionHub
{
    public static string FlowStatusGroup(int carId) => $"flow-status-{carId}";

    /// <summary>Optional, so hubs built without it (tests) keep working on connect and disconnect.</summary>
    private FlowValueDemand? FlowValues => Context.GetHttpContext()?.RequestServices.GetService<FlowValueDemand>();

    // -- Onboard → server ----------------------------------------------------------------

    public async Task ReportOnboardFlowStatus(OnboardFlowStatus status)
    {
        // The car follows from the calling onboard connection, never from the payload.
        if (!_connectionStore.TryGetCarId(Context.ConnectionId, out var carId)) return;
        if (_connectionStore.TryGetValue(carId.ToString(), out var info)) info.FlowStatus = status;
        await Service<IHubContext<CarConnectionHub>>().Clients.Group(FlowStatusGroup(carId)).SendAsync("OnboardFlowStatus", carId, status);
    }

    public async Task ReportVehicleInputDevices(VehicleInputDeviceInfo[] devices)
    {
        if (!_connectionStore.TryGetCarId(Context.ConnectionId, out var carId)) return;
        var db = Service<SignalRCContext>();
        var existing = await db.VehicleInputDevices.Include(d => d.Channels).Where(d => d.CarId == carId).ToListAsync();
        var now = DateTime.UtcNow;
        foreach (var reported in devices.Where(d => !string.IsNullOrWhiteSpace(d.Key)).Take(32))
        {
            var key = Truncate(reported.Key, 512);
            var device = existing.FirstOrDefault(d => d.DeviceKey == key);
            if (device == null)
            {
                device = new VehicleInputDevice { CarId = carId, DeviceKey = key };
                db.VehicleInputDevices.Add(device);
                existing.Add(device);
            }
            device.Name = Truncate(reported.Name, 256);
            device.LastSeenUtc = now;
            // Channels are only added: nodes keep pointing to a channel even if a later report lacks it.
            foreach (var ch in reported.Channels.Take(512))
            {
                var channel = device.Channels.FirstOrDefault(c => c.Code == ch.Code && c.IsAxis == ch.IsAxis);
                if (channel == null)
                    device.Channels.Add(new VehicleInputChannel { Code = ch.Code, IsAxis = ch.IsAxis, Name = Truncate(ch.Name, 64) });
                else
                    channel.Name = Truncate(ch.Name, 64);
            }
        }
        await db.SaveChangesAsync();
        Logger.LogInformation("Car {CarId} reports {Count} controller(s)", carId, devices.Length);
    }

    private static string Truncate(string? s, int max) => s == null ? string.Empty : s.Length <= max ? s : s[..max];

    // -- Browser → server → onboard ------------------------------------------------------

    public async Task UpdateFlowHandoff(int carId, string sessionId, int nodeId, decimal value)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo) || connectionInfo.ConnectionId == null)
            return;
        await Clients.Client(connectionInfo.ConnectionId).UpdateFlowHandoff(sessionId, nodeId, value);
    }

    public async Task<bool> SetWebDetached(int carId, string sessionId, bool detached)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo) || connectionInfo.ConnectionId == null)
            return false;
        var result = await Clients.Client(connectionInfo.ConnectionId).SetWebDetached(sessionId, detached);
        Logger.LogInformation("Car {CarId}: web {State}", carId, result ? "detached" : "attached");
        return result;
    }

    public async Task<BluetoothResult> VehicleBluetooth(int carId, string sessionId, string action, string? address)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var connectionInfo) || connectionInfo.ConnectionId == null)
            return new BluetoothResult { Success = false, Message = "Vehicle not connected" };
        return await Clients.Client(connectionInfo.ConnectionId).Bluetooth(sessionId, action, address);
    }

    public async Task<OnboardFlowStatus?> SubscribeToFlowStatus(int carId)
    {
        if (!await Service<OverlayAccess>().CanViewCarAsync(carId)) throw new HubException("Vehicle not found.");
        await Groups.AddToGroupAsync(Context.ConnectionId, FlowStatusGroup(carId));
        return _connectionStore.TryGetValue(carId.ToString(), out var info) ? info.FlowStatus : null;
    }

    public Task UnsubscribeFromFlowStatus(int carId) =>
        Groups.RemoveFromGroupAsync(Context.ConnectionId, FlowStatusGroup(carId));

    // Node values only while a flow editor is open (FlowValueDemand).
    public async Task SubscribeToFlowValues(int carId)
    {
        if (!await Service<OverlayAccess>().CanViewCarAsync(carId)) throw new HubException("Vehicle not found.");
        if (Service<FlowValueDemand>().Add(carId, Context.ConnectionId))
            await SendFlowValueDemandAsync(carId, true);
    }

    public async Task UnsubscribeFromFlowValues(int carId)
    {
        if (Service<FlowValueDemand>().Remove(carId, Context.ConnectionId))
            await SendFlowValueDemandAsync(carId, false);
    }

    /// <summary>Tells the vehicle whether anyone shows its flow values; ignored if it is not connected.</summary>
    private async Task SendFlowValueDemandAsync(int carId, bool wanted)
    {
        if (!_connectionStore.TryGetValue(carId.ToString(), out var info) || info.ConnectionId == null) return;
        try
        {
            await Service<IHubContext<CarConnectionHub, SignalRC.Shared.HubClients.IConnectionHubClient>>().Clients.Client(info.ConnectionId).SetFlowValueDemand(wanted);
        }
        catch (Exception ex)
        {
            Logger.LogDebug(ex, "SetFlowValueDemand for car {CarId} failed", carId);
        }
    }
}
