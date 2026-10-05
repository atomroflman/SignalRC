using LteCar.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace LteCar.Server.Controllers;

[ApiController]
public class VersionController : Microsoft.AspNetCore.Mvc.ControllerBase
{
    public IServerBuildInfoService BuildInfo { get; }
    public CarConnectionStore ConnectionStore { get; }

    public VersionController(IServerBuildInfoService buildInfo, CarConnectionStore connectionStore)
    {
        BuildInfo = buildInfo;
        ConnectionStore = connectionStore;
    }

    [HttpGet("api/version")]
    public IActionResult Get()
    {
        var info = BuildInfo.GetBuildInfo();
        return Ok(new { branch = info.Branch, commit = info.Commit });
    }

    [HttpGet("api/cars/{carId:int}/version-sync")]
    public IActionResult GetVersionSync(int carId)
    {
        var server = BuildInfo.GetBuildInfo();
        var key = carId.ToString();
        ConnectionStore.TryGetValue(key, out var info);
        var onboardBranch = info?.OnboardBranch;
        var onboardCommit = info?.OnboardCommit;
        var onboard = onboardBranch == null && onboardCommit == null
            ? null
            : new { branch = onboardBranch, commit = onboardCommit };
        var mismatch = onboard != null
            && (onboardBranch != server.Branch || onboardCommit != server.Commit);
        return Ok(new { server = new { branch = server.Branch, commit = server.Commit }, onboard, mismatch });
    }
}