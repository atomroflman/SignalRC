namespace SignalRC.Shared;

public class CarStateModel
{
    public string Id { get; set; } = string.Empty;
    public bool IsConnected { get; set; }
    public string? DriverId { get; set; }
    public string? DriverName { get; set; }
    /// <summary>
    /// Security.VehicleAuthState of the vehicle's connection; "updateOnly" or "keyConflict"
    /// while it is only connected in update mode (IsConnected is false then).
    /// </summary>
    public string? AuthState { get; set; }
}