namespace SignalRC.Server.Data
{
    public class UserSetupTelemetry : EntityBase
    {
        public int CarTelemetryId { get; set; }
        public CarTelemetry CarTelemetry { get; set; } = null!;
        public int UserSetupId { get; set; }
        public UserCarSetup UserSetup { get; set; } = null!;
        public int Order { get; set; }
        public int? OverrideTicks { get; set; }
    }
}