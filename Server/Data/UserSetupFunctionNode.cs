namespace LteCar.Server.Data;

public class UserSetupFunctionNode : UserSetupFlowNodeBase
{
    public string SetupFunctionName { get; set; } = string.Empty;
    public ICollection<UserSetupFunctionNodeParameter> Parameters { get; set; } = new List<UserSetupFunctionNodeParameter>();
}
