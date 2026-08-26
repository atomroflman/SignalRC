namespace SignalRC.Server.Data;

public class UserSetupLink : EntityBase
{
    public int UserSetupFromNodeId { get; set; }
    public UserSetupFlowNodeBase UserSetupFromNode { get; set; } = null!;
    
    public int UserSetupToNodeId { get; set; }
    public UserSetupFlowNodeBase UserSetupToNode { get; set; } = null!;
    public string? SourcePort { get; set; }
    public string? TargetPort { get; set; }
}
