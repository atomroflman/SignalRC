using System.ComponentModel.DataAnnotations;

namespace LteCar.Server.Configuration;

public class ApplicationConfiguration
{
    public const string SectionName = "";

    [Required]
    public ConnectionStrings ConnectionStrings { get; set; } = new();

    [Required]
    public JanusConfiguration JanusConfiguration { get; set; } = new();

    public FileTransferConfiguration FileTransfer { get; set; } = new();

    public WebRtcConfiguration WebRtc { get; set; } = new();
}

public class ConnectionStrings
{
    [Required]
    [MinLength(1)]
    public string DefaultConnection { get; set; } = string.Empty;
}

public class JanusConfiguration
{
    public const string SectionName = "JanusConfiguration";

    [Required]
    [MinLength(1)]
    public string HostName { get; set; } = "localhost";

    [Range(1024, 65535)]
    public int PortRangeStart { get; set; } = 10000;
    [Range(1024, 65535)]
    public int PortRangeEnd { get; set; } = 11000;

    public void Validate()
    {
        if (PortRangeStart > PortRangeEnd)
            throw new InvalidOperationException("UdpPortRangeStart must be less than UdpPortRangeEnd");
    }
}

public class WebRtcConfiguration
{
    public const string SectionName = "WebRtc";

    public List<string> Urls { get; set; } = new();

    public string Username { get; set; } = string.Empty;

    public string Credential { get; set; } = string.Empty;
}