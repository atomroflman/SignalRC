using System.ComponentModel.DataAnnotations;

namespace SignalRC.Server.Data;

/// <summary>
/// A controller connected to a vehicle, as the onboard reported it (T12). Belongs to the
/// vehicle (E14): every driver can use its channels in their flow.
/// </summary>
public class VehicleInputDevice : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;
    /// <summary>Key from the onboard (Bluetooth address or vendor:product, plus the name).</summary>
    [MaxLength(512)]
    public string DeviceKey { get; set; } = string.Empty;
    [MaxLength(256)]
    public string Name { get; set; } = string.Empty;
    public DateTime LastSeenUtc { get; set; }
    public ICollection<VehicleInputChannel> Channels { get; set; } = new List<VehicleInputChannel>();
}

public class VehicleInputChannel : EntityBase
{
    public int VehicleInputDeviceId { get; set; }
    public VehicleInputDevice VehicleInputDevice { get; set; } = null!;
    /// <summary>evdev code: ABS_* for axes, BTN_*/KEY_* for buttons.</summary>
    public int Code { get; set; }
    public bool IsAxis { get; set; }
    [MaxLength(64)]
    public string Name { get; set; } = string.Empty;
    public ICollection<UserSetupVehicleInputNode> SetupNodes { get; set; } = new List<UserSetupVehicleInputNode>();
}
