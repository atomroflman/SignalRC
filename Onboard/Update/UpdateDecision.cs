using SignalRC.Shared.Update;

namespace SignalRC.Onboard.Update;

/// <summary>Everything <see cref="UpdateDecision.Decide"/> looks at, gathered by the update service.</summary>
/// <param name="RunningRelease">Null when the onboard does not run from the release layout.</param>
/// <param name="RuntimeIdentifier">Null when the architecture has no package (e.g. 32-bit ARM).</param>
/// <param name="InstalledRuntimes">Microsoft.NETCore.App versions installed next to the running dotnet.</param>
public sealed record UpdateInputs(
    string LocalBranch,
    string? LocalCommit,
    string? RunningRelease,
    OnboardPackageManifest Manifest,
    string? RuntimeIdentifier,
    bool AutoUpdateEnabled,
    IReadOnlySet<string> Blocked,
    IReadOnlyCollection<Version> InstalledRuntimes,
    bool DriverActive);

/// <summary>What to do; <see cref="State"/> is one of the <see cref="OnboardUpdateStatus"/> constants.</summary>
public sealed record UpdateVerdict(
    string State,
    string? TargetCommit = null,
    OnboardPackageInfo? Package = null,
    string? Message = null,
    bool CanUpdateManually = false)
{
    /// <summary>Install right away without being asked.</summary>
    public bool InstallAutomatically => State == OnboardUpdateStatus.Installing;
}

/// <summary>
/// The rules of Docs/OnboardAutoUpdate.md, kept free of I/O so they can be tested:
/// any branch or commit difference to the server triggers; the automatic update needs
/// AutoUpdate.Enabled, no driver and an unblocked commit; a driver's manual update
/// ignores the switch and the block list, but not a missing runtime.
/// </summary>
public static class UpdateDecision
{
    public static bool IsOutdated(string localBranch, string? localCommit, string? serverBranch, string? serverCommit)
    {
        if (string.IsNullOrEmpty(serverCommit)) return false;
        var branchDiffers = !string.Equals(localBranch, serverBranch, StringComparison.OrdinalIgnoreCase);
        var commitDiffers = !string.Equals(localCommit, serverCommit, StringComparison.OrdinalIgnoreCase);
        return branchDiffers || commitDiffers;
    }

    public static UpdateVerdict Decide(UpdateInputs inputs)
    {
        if (inputs.RunningRelease == null)
            return new UpdateVerdict(OnboardUpdateStatus.Disabled,
                Message: "Das Onboard läuft nicht aus dem Release-Layout (Onboard/current). Einmal sudo ./update.sh ausführen.");

        var manifest = inputs.Manifest;
        if (!IsOutdated(inputs.LocalBranch, inputs.LocalCommit, manifest.Branch, manifest.Commit))
            return new UpdateVerdict(OnboardUpdateStatus.UpToDate);

        var target = manifest.Commit!;
        if (inputs.RuntimeIdentifier == null
            || !manifest.Packages.TryGetValue(inputs.RuntimeIdentifier, out var package))
            return new UpdateVerdict(OnboardUpdateStatus.NoPackage, target,
                Message: inputs.RuntimeIdentifier == null
                    ? "Für diese Architektur gibt es kein Onboard-Paket."
                    : $"Der Server bietet kein Paket für {inputs.RuntimeIdentifier} an.");

        if (!IsRuntimeAvailable(package.Framework, inputs.InstalledRuntimes))
            return new UpdateVerdict(OnboardUpdateStatus.RuntimeMissing, target, package,
                Message: $"Das Paket braucht .NET {package.Framework}, installiert ist {DescribeRuntimes(inputs.InstalledRuntimes)}.");

        // From here a driver could start it.
        if (inputs.Blocked.Contains(ReleaseLayout.ReleaseName(target)))
            return new UpdateVerdict(OnboardUpdateStatus.Blocked, target, package,
                Message: "Dieser Stand wurde zurückgerollt und wird nicht automatisch erneut installiert.",
                CanUpdateManually: true);
        if (!inputs.AutoUpdateEnabled)
            return new UpdateVerdict(OnboardUpdateStatus.Available, target, package, CanUpdateManually: true);
        if (inputs.DriverActive)
            return new UpdateVerdict(OnboardUpdateStatus.WaitingForDriver, target, package, CanUpdateManually: true);
        return new UpdateVerdict(OnboardUpdateStatus.Installing, target, package);
    }

    /// <summary>
    /// Mirrors the default roll-forward of framework-dependent apps: same major, and the
    /// installed minor.patch at least the requested one. Unknown requirement passes.
    /// </summary>
    public static bool IsRuntimeAvailable(string? required, IReadOnlyCollection<Version> installed)
    {
        if (string.IsNullOrEmpty(required) || !TryParseVersion(required, out var need)) return true;
        return installed.Any(have => have.Major == need.Major
            && (have.Minor > need.Minor || (have.Minor == need.Minor && Math.Max(have.Build, 0) >= Math.Max(need.Build, 0))));
    }

    /// <summary>Parses "10.0.3" and preview versions like "11.0.0-preview.1" (suffix dropped).</summary>
    public static bool TryParseVersion(string text, out Version version)
    {
        var dash = text.IndexOf('-');
        return Version.TryParse(dash < 0 ? text : text[..dash], out version!);
    }

    private static string DescribeRuntimes(IReadOnlyCollection<Version> installed) =>
        installed.Count == 0 ? "keine" : string.Join(", ", installed.OrderBy(v => v));
}
