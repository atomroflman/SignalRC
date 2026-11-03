using SignalRC.Server.Services;
using Microsoft.AspNetCore.Mvc;

namespace SignalRC.Server.Controllers;

/// <summary>
/// Onboard self-update downloads (Docs/OnboardAutoUpdate.md). Anonymous like
/// /api/version and the install script; the onboard checks the SHA256 from the manifest.
/// </summary>
[ApiController]
[Route("api/onboard/packages")]
public class OnboardPackagesController : Microsoft.AspNetCore.Mvc.ControllerBase
{
    public OnboardPackageService Packages { get; }

    public OnboardPackagesController(OnboardPackageService packages)
    {
        Packages = packages;
    }

    [HttpGet]
    public IActionResult GetManifest() => Ok(Packages.GetManifest());

    [HttpGet("{rid}")]
    public IActionResult Download(string rid)
    {
        if (!Packages.TryGetPackagePath(rid, out var path))
            return NotFound();
        // Range requests let a download that broke off over LTE continue.
        return PhysicalFile(path, "application/zip", $"signalrc-onboard-{rid}.zip", enableRangeProcessing: true);
    }
}
