using SignalRC.Shared.Update;

namespace SignalRC.Shared.HubClients;

public interface IOnboardUpdateClient
{
    // Onboard: a driver asks for the update. Only the holder of the control session may.
    Task<OnboardUpdateRequestResult> StartOnboardUpdate(string sessionId);

    // Browser broadcast; the onboard implements it as a no-op.
    Task OnboardUpdateStatusChanged(int carId, OnboardUpdateStatus status);
}
