using SignalRC.Server;
using SignalRC.Server.Data;

namespace SignalRC.Overlay.Tests.Testing;

/// <summary>
/// The live control state OverlayAccess reads (D73), as the hub leaves it after
/// OpenCarConnection, AquireCarControl, ReleaseCarControl and a disconnect.
/// </summary>
public static class ControlState
{
    /// <summary>Onboard connected; <paramref name="driver"/> acquired control (null: nobody).</summary>
    public static CarConnectionStore Connected(int carId, User? driver = null)
    {
        var store = new CarConnectionStore();
        store.Connect(carId);
        if (driver != null) store.Acquire(carId, driver);
        return store;
    }

    public static void Connect(this CarConnectionStore store, int carId) =>
        store.RegisterConnection(carId.ToString(), $"onboard-{carId}");

    public static void Acquire(this CarConnectionStore store, int carId, User driver)
    {
        var session = $"session-{carId}-{driver.Id}";
        store[carId.ToString()].DriverId = driver.Id.ToString();
        store.RememberControlSession(carId.ToString(), session);
    }

    public static void Release(this CarConnectionStore store, int carId)
    {
        var info = store[carId.ToString()];
        info.ControlSessionHash = null;
        info.DriverId = null;
    }

    public static void Disconnect(this CarConnectionStore store, int carId) =>
        store.TryRemoveConnection($"onboard-{carId}", out _, out _);
}
