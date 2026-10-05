using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data
{
    public class UserCarSetup : EntityBase
    {
        public int UserId { get; set; }
        public User User { get; set; } = null!;
        public int CarId { get; set; }
        public Car Car { get; set; } = null!;
        [MaxLength(64)]
        public string? CarSecret { get; set; }
        public ICollection<UserSetupTelemetryNode> TelemetryNodes { get; set; } = new List<UserSetupTelemetryNode>();
    }
}