using SignalRC.Shared.Update;

namespace SignalRC.Shared.HubClients;

public interface IOnboardUpdateClient
{
    // Onboard: a driver asks for the update. Only the holder of the control session may.
    Task<OnboardUpdateRequestResult> StartOnboardUpdate(string sessionId);

    // Browser broadcast; the onboard implements it as a no-op.
    Task OnboardUpdateStatusChanged(int carId, OnboardUpdateStatus status);

    // Browser broadcast: the onboard reported its version or disconnected, so
    // GET version-sync has news. The onboard implements it as a no-op.
    Task OnboardVersionChanged(int carId);
}
