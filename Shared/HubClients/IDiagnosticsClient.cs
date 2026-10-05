using System.Threading.Tasks;
using LteCar.Shared.Video;

namespace LteCar.Shared.HubClients;

public interface IDiagnosticsClient
{
    Task<OnboardDiagnosticsReport> GetOnboardDiagnostics();
    Task<OnboardDiagnosticsReport> RunOnboardStartupTest();
}
