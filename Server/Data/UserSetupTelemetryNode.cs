namespace LteCar.Server.Data;

public class UserSetupTelemetryNode : UserSetupFlowNodeBase
{
    public int TelemetryId { get; set; }
    public CarTelemetry Telemetry { get; set; } = null!;
}
