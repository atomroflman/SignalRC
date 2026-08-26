using System.Threading.Tasks;
using SignalRC.Shared.Video;

namespace SignalRC.Shared.HubClients;

public interface IDiagnosticsClient
{
    Task<OnboardDiagnosticsReport> GetOnboardDiagnostics();
    Task<OnboardDiagnosticsReport> RunOnboardStartupTest();
}
