namespace LteCar.Server.Data;

public class UserSetupCarChannelNode : UserSetupFlowNodeBase
{
    public int CarChannelId { get; set; }
    public CarChannel CarChannel { get; set; } = null!;
}
