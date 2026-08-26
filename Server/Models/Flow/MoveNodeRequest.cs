namespace SignalRC.Server.Controllers
{
    public partial class FlowController
    {
        public class MoveNodeRequest
        {
            public int NodeId { get; set; }
            public float PositionX { get; set; }
            public float PositionY { get; set; }
        }
    }
}
