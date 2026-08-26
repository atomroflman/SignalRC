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
        }
    }
}
