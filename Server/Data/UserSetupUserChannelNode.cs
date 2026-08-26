namespace SignalRC.Server.Data;

public class UserSetupUserChannelNode : UserSetupFlowNodeBase
{
    public int UserChannelId { get; set; }
    public UserChannel? UserChannel { get; set; }
}
