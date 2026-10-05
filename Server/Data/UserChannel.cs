namespace LteCar.Server.Data;

public class UserChannel : EntityBase
{
    public int UserChannelDeviceId { get; set; }
    public UserChannelDevice UserChannelDevice { get; set; } = null!;

    public string? Name { get; set; }
    public int ChannelId { get; set; }
    public bool IsAxis { get; set; }
    /// <summary>
    /// The number of decimal places to round the value to for axes.
    /// </summary>
    public int Accuracy { get; set; } = 4;
    public float? CalibrationMin { get; set; } = -1;
    public float? CalibrationMax { get; set; } = 1;
    public ICollection<UserSetupUserChannelNode> SetupNodes { get; set; } = new List<UserSetupUserChannelNode>();
}