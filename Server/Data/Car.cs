namespace LteCar.Server.Data;

public class Car : EntityBase
{
    public string? Name { get; set; }
    public string CarIdentityKey { get; set; } = string.Empty;
    public string ChannelMapHash { get; set; } = string.Empty;
    public DateTime LastSeen { get; set; } = DateTime.Now;
    public ICollection<CarChannel> Functions { get; set; } = new List<CarChannel>();
    public ICollection<UserCarSetup> UserCarSetups { get; set; } = new List<UserCarSetup>();
    public ICollection<CarVideoStream> VideoStreams { get; set; } = new List<CarVideoStream>();
    public ICollection<CarPinManager> PinManagers { get; set; } = new List<CarPinManager>();

    public override string ToString()
    {
        return $"{Name ?? CarIdentityKey} (ID: {Id})";
    }
}