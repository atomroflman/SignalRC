using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Data
{
    public class CarTelemetry : EntityBase
    {
        [MaxLength(64)]
        public string ChannelName { get; set; } = string.Empty;
        public int CarId { get; set; }
        public Car Car { get; set; } = null!;
        public int ReadIntervalTicks { get; set; }
        [MaxLength(64)]
        public string TelemetryType { get; set; } = string.Empty;

        public LteCar.Shared.Channels.TelemetryDataType DataType { get; set; } = LteCar.Shared.Channels.TelemetryDataType.String;
        [MaxLength(32)]
        public string? Unit { get; set; }
        public byte? Decimals { get; set; }

        [MaxLength(64)]
        public string PinManager { get; set; } = string.Empty;
        public int? Address { get; set; }
        public string? OptionsJson { get; set; }
        public int? ServerId { get; set; }
        public DateTime? ModifiedAt { get; set; }
    }
}