using LteCar.Server.Configuration;
using Microsoft.AspNetCore.Mvc;

namespace LteCar.Server.Controllers;

[ApiController]
public class WebRtcController : Microsoft.AspNetCore.Mvc.ControllerBase
{
    private static readonly string[] DefaultStunUrls = { "stun:stun.l.google.com:19302" };

    public IConfigurationService Config { get; }

    public WebRtcController(IConfigurationService config)
    {
        Config = config;
    }

    [HttpGet("api/webrtc/ice-servers")]
    public IActionResult GetIceServers()
    {
        var iceServers = new List<object>
        {
            new { urls = DefaultStunUrls },
        };

        var turn = Config.WebRtc;
        if (turn.Urls.Count > 0 && !string.IsNullOrEmpty(turn.Username) && !string.IsNullOrEmpty(turn.Credential))
        {
            iceServers.Add(new
            {
                urls = turn.Urls.ToArray(),
                username = turn.Username,
                credential = turn.Credential,
            });
        }

        return Ok(new { iceServers });
    }
}
