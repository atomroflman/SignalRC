namespace SignalRC.Server.Controllers
{
    public partial class FlowController
    {
        public class AddNodeRequest
        {
            public int UserSetupId { get; set; }
            public int Id { get; set; }
            public float PositionX { get; set; } = 100;
            public float PositionY { get; set; } = 100;
            public string? SetupFunctionName { get; set; }
            /// <summary>Zone for function and output nodes (OnboardFlow-Arbeitspakete.md T01); other nodes have a fixed zone.</summary>
            public SignalRC.Shared.Flow.FlowZone? Zone { get; set; }
            /// <summary>Name of a handoff node.</summary>
            public string? Name { get; set; }
        }
    }
}
