namespace LteCar.Shared;

public class CarStateModel
{
    public string Id { get; set; } = string.Empty;
    public bool IsConnected { get; set; }
    public string? DriverId { get; set; }
    public string? DriverName { get; set; }
}