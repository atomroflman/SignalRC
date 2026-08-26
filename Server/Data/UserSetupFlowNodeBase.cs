namespace SignalRC.Server.Data;

public abstract class UserSetupFlowNodeBase : EntityBase
{
    public int UserSetupId { get; set; }
    public UserCarSetup? UserSetup { get; set; }
    public float PositionX { get; set; } = 100;
    public float PositionY { get; set; } = 100;
}
