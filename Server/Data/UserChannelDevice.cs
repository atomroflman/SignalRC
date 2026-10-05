using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data;
public class UserChannelDevice : EntityBase
{
    [MaxLength(512)]
    public string DeviceName { get; set; } = string.Empty;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public ICollection<UserChannel> Channels { get; set; } = new List<UserChannel>();
}
