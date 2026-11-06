namespace SignalRC.Server.Data;

/// <summary>An axis or button of a controller connected to the vehicle (T05). Onboard zone only.</summary>
public class UserSetupVehicleInputNode : UserSetupFlowNodeBase
{
    public int VehicleInputChannelId { get; set; }
    public VehicleInputChannel? VehicleInputChannel { get; set; }
}
