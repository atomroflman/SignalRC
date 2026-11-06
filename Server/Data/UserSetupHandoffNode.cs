using System.ComponentModel.DataAnnotations;

namespace SignalRC.Server.Data;

/// <summary>
/// Boundary between browser and onboard flow (OnboardFlow-Arbeitspakete.md T02): takes one
/// value from the browser zone (input "in") and offers it to the onboard zone as
/// "value" and "connected". Always in the Onboard zone.
/// </summary>
public class UserSetupHandoffNode : UserSetupFlowNodeBase
{
    [MaxLength(64)]
    public string Name { get; set; } = string.Empty;
}
