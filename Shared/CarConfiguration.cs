using SignalRC.Shared.Channels;
using SignalRC.Shared.Video;

namespace SignalRC.Shared;

public class CarConfiguration : IConfigurationModel
{
    public int ServerAssignedCarId { get; set; }
    public JanusConfiguration? JanusConfiguration { get; set; }
    public VideoSettings? VideoSettings { get; set; }

    /// <summary>
    /// Server-pushed channel map (SPOT). Only set when the server pushes the current config
    /// during connection handshake, e.g. because the client's hash was out of date.
    /// </summary>
    public ChannelMap? ChannelMap { get; set; }

    /// <summary>
    /// Hash of the server-pushed channel map. The client should compare this with its local hash.
    /// </summary>
    public string ChannelMapHash { get; set; } = string.Empty;
}