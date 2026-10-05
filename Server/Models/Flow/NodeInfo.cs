namespace LteCar.Server.Controllers
{
    public partial class FlowController
    {
        public class NodeInfo
        {
            public int NodeId { get; set; }
            public int? RepresentingId { get; set; }
            public string Type { get; set; } = string.Empty;
            public NodePosition Position { get; set; } = new NodePosition();
            public string Label { get; set; } = string.Empty;
            public object? Metadata { get; set; }
            public string NodeTypeName { get; set; } = string.Empty;
            public Dictionary<string, string?>? Params { get; set; }
            public int? MaxResendInterval { get; set; }
        }
    }
}
