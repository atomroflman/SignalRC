using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Security;
using SignalRC.Shared;
using SignalRC.Shared.Security;

namespace SignalRC.Server.Hubs;

// Docs/VehicleKeyAuth.md: a vehicle signs its handshake with its device key. The first
// signed handshake stores that key (TOFU); later ones must match it. Every other
// onboard connection runs in update mode: it may report its version and update itself,
// nothing else, and it never takes the place of the signed-in vehicle.
public partial class CarConnectionHub
{
    private const int MaxIdentityKeyLength = 200;

    private static string VehicleNonceScope(string connectionId) => $"vehicle:{connectionId}";

    public Task<string> GetVehicleNonce() =>
        Task.FromResult(Service<NonceStore>().Issue(VehicleNonceScope(Context.ConnectionId)));

    public async Task<CarConfiguration> OpenVehicleConnection(VehicleHello hello)
    {
        var db = Service<SignalRCContext>();
        var identity = hello.CarIdentityKey ?? "";
        if (identity.Length == 0 || identity.Length > MaxIdentityKeyLength)
            return await EnterUpdateModeAsync(null, hello.ChannelMapHash, VehicleAuthState.UpdateOnly);

        var car = await db.Cars.FirstOrDefaultAsync(c => c.CarIdentityKey == identity);
        var nonceOk = Service<NonceStore>().TryConsume(hello.Nonce, VehicleNonceScope(Context.ConnectionId));
        if (!nonceOk || !VehicleKeys.VerifyDeviceSignature(hello.DevicePublicKey, hello.Nonce, hello.Signature))
        {
            Logger.LogWarning("Vehicle handshake for identity {Identity} rejected: {Reason}. Update mode only.",
                identity, nonceOk ? "invalid device signature" : "unknown, expired or reused nonce");
            return await EnterUpdateModeAsync(car, hello.ChannelMapHash, VehicleAuthState.UpdateOnly);
        }

        var fingerprint = VehicleKeys.Fingerprint(hello.DevicePublicKey);
        if (car == null)
        {
            // LastSeen in UTC before the first save: Npgsql refuses the entity's local-time default.
            car = new Car { CarIdentityKey = identity, Name = identity, DevicePublicKey = hello.DevicePublicKey, DeviceKeyFingerprint = fingerprint, LastSeen = DateTime.UtcNow };
            db.Cars.Add(car);
            await db.SaveChangesAsync();
            Logger.LogWarning("New vehicle {Identity} (ID {CarId}) registered with device key {Fingerprint}.", identity, car.Id, fingerprint);
        }
        else if (car.DevicePublicKey == null)
        {
            car.DevicePublicKey = hello.DevicePublicKey;
            car.DeviceKeyFingerprint = fingerprint;
            await db.SaveChangesAsync();
            Logger.LogWarning("Vehicle {CarId} stored its device key on first use: {Fingerprint}.", car.Id, fingerprint);
        }
        else if (car.DevicePublicKey != hello.DevicePublicKey)
        {
            Logger.LogError(
                "Vehicle {CarId} signed with device key {Fingerprint}, but {Stored} is stored. Update mode only; " +
                "if the vehicle was set up anew, clear DevicePublicKey of the car in the database (Docs/VehicleKeyAuth.md).",
                car.Id, fingerprint, car.DeviceKeyFingerprint);
            return await EnterUpdateModeAsync(car, hello.ChannelMapHash, VehicleAuthState.KeyConflict);
        }

        Logger.LogInformation("Vehicle {CarId} signed in with device key {Fingerprint}.", car.Id, fingerprint);
        return await OpenAuthenticatedAsync(car, hello.ChannelMapHash, db);
    }

    /// <summary>Handshake of onboards without a device key: update mode only.</summary>
    public async Task<CarConfiguration> OpenCarConnection(string carIdentityKey, string channelMapHash)
    {
        var db = Service<SignalRCContext>();
        var car = string.IsNullOrEmpty(carIdentityKey) || carIdentityKey.Length > MaxIdentityKeyLength
            ? null
            : await db.Cars.FirstOrDefaultAsync(c => c.CarIdentityKey == carIdentityKey);
        Logger.LogWarning("Unsigned handshake for identity {Identity} (car {CarId}): update mode only until the onboard is updated.",
            carIdentityKey, car?.Id);
        return await EnterUpdateModeAsync(car, channelMapHash, VehicleAuthState.UpdateOnly);
    }

    public async Task ReportOwnerPublicKey(string ownerPublicKey)
    {
        if (!_connectionStore.TryGetCarId(Context.ConnectionId, out var carId))
        {
            Logger.LogWarning("ReportOwnerPublicKey ignored: no signed-in vehicle connection");
            return;
        }
        if (!VehicleKeys.IsOwnerPublicKey(ownerPublicKey))
        {
            Logger.LogWarning("Vehicle {CarId} reported an invalid owner public key", carId);
            return;
        }
        var db = Service<SignalRCContext>();
        var car = await db.Cars.FirstOrDefaultAsync(c => c.Id == carId);
        if (car == null || car.OwnerPublicKey == ownerPublicKey) return;

        var hadKey = car.OwnerPublicKey != null;
        car.OwnerPublicKey = ownerPublicKey;
        car.OwnerKeyFingerprint = VehicleKeys.Fingerprint(ownerPublicKey);
        car.OwnerKeyChangedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var ended = Service<ConfigSessionStore>().RevokeCar(carId);
        Logger.LogWarning("Vehicle {CarId} {Action} owner key {Fingerprint}; {Ended} config session(s) ended.",
            carId, hadKey ? "changed its" : "reported its", car.OwnerKeyFingerprint, ended);
    }

    /// <summary>
    /// Update mode: the onboard keeps its own channel map (no map, its own hash echoed),
    /// joins no group and is not entered as the vehicle. Its version report and
    /// self-update keep working, so an old onboard reaches the release that signs in.
    /// </summary>
    private async Task<CarConfiguration> EnterUpdateModeAsync(Car? car, string? clientHash, string state)
    {
        _connectionStore.EnterUpdateMode(Context.ConnectionId, car?.Id, state);
        var config = new CarConfiguration
        {
            ServerAssignedCarId = car?.Id ?? 0,
            ChannelMap = null,
            ChannelMapHash = clientHash ?? string.Empty,
            AuthState = state,
        };
        if (!string.IsNullOrWhiteSpace(_configService.Janus.PublicHostName))
            config.JanusConfiguration = new JanusConfiguration { JanusServerHost = _configService.Janus.PublicHostName };
        if (car != null && !_connectionStore.ContainsKey(car.Id.ToString()))
            await Clients.All.CarStateUpdated(new CarStateModel { Id = car.Id.ToString(), IsConnected = false, AuthState = state });
        return config;
    }

    /// <summary>The car of an update-mode connection, for the reports it may still send.</summary>
    private bool TryGetUpdateModeCar(out int carId, out UpdateModeConnection entry)
    {
        carId = 0;
        if (!_connectionStore.TryGetUpdateMode(Context.ConnectionId, out entry) || entry.CarId == null) return false;
        carId = entry.CarId.Value;
        return true;
    }
}
