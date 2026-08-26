namespace SignalRC.Server.Controllers
{
    public partial class FlowController
    {
        public class LinkNodeRequest
        {
            public int FromNodeId { get; set; }
            public int ToNodeId { get; set; }
            public string? FromPort { get; set; }
            public string? ToPort { get; set; }
        }
    }
}
