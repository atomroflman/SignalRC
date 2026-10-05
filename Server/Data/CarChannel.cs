using System.ComponentModel.DataAnnotations;
using LteCar.Server.Data.EntityMapping;

namespace LteCar.Server.Data
{
    public class CarChannel : EntityBase
    {
        [MaxLength(64)]
        public string? DisplayName { get; set; }
        [MaxLength(64)]
        public string ChannelName { get; set; } = string.Empty;
        public bool IsEnabled { get; set; }
        public bool RequiresAxis { get; set; }
        public int? MaxResendInterval { get; set; }
        [MaxLength(64)]
        public string? ControlType { get; set; }
        [MaxLength(64)]
        public string PinManager { get; set; } = "default";
        public int? Address { get; set; }
        public string? OptionsJson { get; set; }
        public bool TestDisabled { get; set; }
        public int? ServerId { get; set; }
        public DateTime? ModifiedAt { get; set; }
        public int CarId { get; set; }
        public Car Car { get; set; } = null!;
        public ICollection<UserSetupCarChannelNode> SetupNodes { get; set; } = new List<UserSetupCarChannelNode>();
    }
}