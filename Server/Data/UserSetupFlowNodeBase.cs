using SignalRC.Shared.Flow;

namespace SignalRC.Server.Data;

public abstract class UserSetupFlowNodeBase : EntityBase
{
    public int UserSetupId { get; set; }
    public UserCarSetup? UserSetup { get; set; }
    public float PositionX { get; set; } = 100;
    public float PositionY { get; set; } = 100;
    /// <summary>Where the node runs (OnboardFlow-Arbeitspakete.md T01). Existing nodes run in the browser.</summary>
    public FlowZone Zone { get; set; } = FlowZone.Browser;
}
