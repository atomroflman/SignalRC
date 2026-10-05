namespace LteCar.Server.Data;

public class UserSetupFunctionNodeParameter : EntityBase
{
    public string ParameterName { get; set; } = string.Empty;
    public string? ParameterValue { get; set; }
    public UserSetupFunctionNode Node { get; set; } = null!;
    public int NodeId { get; set; }
}