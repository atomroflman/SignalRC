using System.IO.Compression;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Update;
using SignalRC.Server.Services;
using SignalRC.Shared.Update;

namespace SignalRC.Overlay.Tests.Update;

/// <summary>Onboard self-update (Docs/OnboardAutoUpdate.md): the rules, the release layout on disk and the server's manifest.</summary>
public class OnboardUpdateTests
{
    private const string Old = "1111111111111111111111111111111111111111";
    private const string New = "2222222222222222222222222222222222222222";

    private static OnboardPackageManifest Manifest(string branch = "master", string commit = New, string? framework = "10.0.0") => new()
    {
        Branch = branch,
        Commit = commit,
        Packages = new()
        {
            ["linux-arm64"] = new OnboardPackageInfo { Url = "/api/onboard/packages/linux-arm64", Sha256 = "ab", Size = 1, Framework = framework },
        },
    };

    private static UpdateInputs Inputs(
        OnboardPackageManifest? manifest = null,
        string localBranch = "master",
        string? localCommit = Old,
        string? runningRelease = "111111111111",
        string? rid = "linux-arm64",
        bool autoUpdate = true,
        IReadOnlySet<string>? blocked = null,
        IReadOnlyCollection<Version>? runtimes = null,
        bool driverActive = false) =>
        new(localBranch, localCommit, runningRelease, manifest ?? Manifest(), rid, autoUpdate,
            blocked ?? new HashSet<string>(), runtimes ?? [new Version(10, 0, 3)], driverActive);

    [Fact]
    public void BranchOrCommitDifferenceIsOutdated()
    {
        Assert.False(UpdateDecision.IsOutdated("master", Old, "master", Old));
        Assert.True(UpdateDecision.IsOutdated("master", Old, "master", New));
        Assert.True(UpdateDecision.IsOutdated("master", Old, "experimental", Old));
        // Without a server commit there is nothing to update to.
        Assert.False(UpdateDecision.IsOutdated("master", Old, "master", null));
    }

    [Fact]
    public void InstallsAutomaticallyOnlyWhenEnabledWithoutDriver()
    {
        Assert.True(UpdateDecision.Decide(Inputs()).InstallAutomatically);

        var off = UpdateDecision.Decide(Inputs(autoUpdate: false));
        Assert.Equal(OnboardUpdateStatus.Available, off.State);
        Assert.True(off.CanUpdateManually);

        var driver = UpdateDecision.Decide(Inputs(driverActive: true));
        Assert.Equal(OnboardUpdateStatus.WaitingForDriver, driver.State);
        Assert.True(driver.CanUpdateManually);
    }

    [Fact]
    public void SameBuildIsUpToDate()
    {
        var verdict = UpdateDecision.Decide(Inputs(manifest: Manifest(commit: Old)));
        Assert.Equal(OnboardUpdateStatus.UpToDate, verdict.State);
        Assert.False(verdict.CanUpdateManually);
    }

    [Fact]
    public void BlockedCommitIsLeftToTheDriver()
    {
        var verdict = UpdateDecision.Decide(Inputs(blocked: new HashSet<string> { "222222222222" }));
        Assert.Equal(OnboardUpdateStatus.Blocked, verdict.State);
        Assert.False(verdict.InstallAutomatically);
        Assert.True(verdict.CanUpdateManually);
    }

    [Fact]
    public void MissingRuntimeOrPackageStopsEvenTheDriver()
    {
        var runtime = UpdateDecision.Decide(Inputs(manifest: Manifest(framework: "11.0.0")));
        Assert.Equal(OnboardUpdateStatus.RuntimeMissing, runtime.State);
        Assert.False(runtime.CanUpdateManually);
        Assert.Contains("11.0.0", runtime.Message);

        var package = UpdateDecision.Decide(Inputs(rid: "linux-x64"));
        Assert.Equal(OnboardUpdateStatus.NoPackage, package.State);
        Assert.False(package.CanUpdateManually);

        Assert.Equal(OnboardUpdateStatus.NoPackage, UpdateDecision.Decide(Inputs(rid: null)).State);
    }

    [Fact]
    public void WithoutReleaseLayoutUpdatesAreDisabled()
    {
        var verdict = UpdateDecision.Decide(Inputs(runningRelease: null));
        Assert.Equal(OnboardUpdateStatus.Disabled, verdict.State);
        Assert.False(verdict.CanUpdateManually);
    }

    [Theory]
    [InlineData("10.0.0", "10.0.3", true)]
    [InlineData("10.0.5", "10.0.3", false)]
    [InlineData("10.0.5", "10.1.0", true)]
    [InlineData("11.0.0", "10.9.9", false)]
    [InlineData("11.0.0-preview.1", "11.0.0", true)]
    [InlineData(null, "10.0.0", true)]
    public void RuntimeRollsForwardLikeDotnet(string? required, string installed, bool available)
    {
        Assert.Equal(available, UpdateDecision.IsRuntimeAvailable(required, [Version.Parse(installed)]));
    }

    [Fact]
    public void PendingRoundTripsInTheScriptFormat()
    {
        var pending = new PendingRelease("222222222222", "111111111111", 2);
        Assert.Equal("commit=222222222222\nprevious=111111111111\nattempts=2\n", pending.Format());
        Assert.Equal(pending, PendingRelease.Parse(pending.Format()));
        Assert.Null(PendingRelease.Parse("unsinn"));
        Assert.Equal(new PendingRelease("a", null, 0), PendingRelease.Parse("commit=a\nprevious=\n"));
    }

    [Fact]
    public void LayoutSwitchesCurrentAtomicallyAndResolvesTheRunningRelease()
    {
        using var dir = new TempDirectory();
        var layout = new ReleaseLayout(dir.Path);
        Install(layout, "111111111111");
        Install(layout, "222222222222");

        layout.SwitchCurrent("111111111111");
        Assert.Equal("111111111111", layout.ReadCurrent());
        // The process started through Onboard/current runs what the link pointed to at startup.
        Assert.Equal("111111111111", layout.ResolveRunningRelease(layout.CurrentLink + "/"));

        layout.SwitchCurrent("222222222222");
        Assert.Equal("222222222222", layout.ReadCurrent());
        Assert.Equal("releases/222222222222", new FileInfo(layout.CurrentLink).LinkTarget);
        Assert.Equal("222222222222", layout.ResolveRunningRelease(layout.ReleaseDirectory("222222222222")));
        Assert.Null(layout.ResolveRunningRelease(Path.Combine(dir.Path, "bin", "Release", "net10.0")));

        Assert.Throws<InvalidOperationException>(() => layout.SwitchCurrent("333333333333"));
    }

    [Fact]
    public void PruneKeepsCurrentThreePreviousAndProtected()
    {
        using var dir = new TempDirectory();
        var layout = new ReleaseLayout(dir.Path);
        var names = Enumerable.Range(1, 7).Select(i => new string((char)('0' + i), 12)).ToArray();
        for (var i = 0; i < names.Length; i++)
        {
            Install(layout, names[i]);
            Directory.SetLastWriteTimeUtc(layout.ReleaseDirectory(names[i]), DateTime.UtcNow.AddMinutes(i - 10));
        }
        layout.SwitchCurrent(names[6]);
        Directory.CreateDirectory(Path.Combine(layout.ReleasesDirectory, "999999999999.tmp"));

        var removed = layout.Prune(3, names[0]);

        Assert.Equal(new[] { names[2], names[1] }, removed);
        Assert.Equal(new[] { names[6], names[5], names[4], names[3], names[0] }, layout.ListReleases());
        layout.CleanTemporary();
        Assert.False(Directory.Exists(Path.Combine(layout.ReleasesDirectory, "999999999999.tmp")));
    }

    [Fact]
    public void BlockedAndLastRollbackAreReadFromTheScriptFiles()
    {
        using var dir = new TempDirectory();
        var layout = new ReleaseLayout(dir.Path);
        Directory.CreateDirectory(layout.StateDirectory);
        File.WriteAllText(layout.BlockedFile, "222222222222\n\n333333333333\n");
        File.WriteAllText(layout.LastRollbackFile, "222222222222\n");

        Assert.Equal(new HashSet<string> { "222222222222", "333333333333" }, layout.ReadBlocked());
        Assert.Equal("222222222222", layout.TakeLastRollback());
        Assert.Null(layout.TakeLastRollback());
    }

    [Fact]
    public void ServerManifestHashesPackagesAndReadsTheFramework()
    {
        using var dir = new TempDirectory();
        var zip = Path.Combine(dir.Path, "linux-arm64.zip");
        using (var archive = ZipFile.Open(zip, ZipArchiveMode.Create))
        {
            using var writer = new StreamWriter(archive.CreateEntry("SignalRC.Onboard.runtimeconfig.json").Open());
            writer.Write("""{"runtimeOptions":{"tfm":"net10.0","framework":{"name":"Microsoft.NETCore.App","version":"10.0.0"}}}""");
        }
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["OnboardPackages:Path"] = dir.Path })
            .Build();
        var service = new OnboardPackageService(new FixedBuildInfo(), configuration, NullLogger<OnboardPackageService>.Instance);

        var manifest = service.GetManifest();

        Assert.Equal(New, manifest.Commit);
        var package = Assert.Single(manifest.Packages).Value;
        Assert.Equal("/api/onboard/packages/linux-arm64", package.Url);
        Assert.Equal("10.0.0", package.Framework);
        Assert.Equal(new FileInfo(zip).Length, package.Size);
        Assert.Equal(64, package.Sha256.Length);
        Assert.True(service.TryGetPackagePath("linux-arm64", out var path));
        Assert.Equal(zip, path);
        Assert.False(service.TryGetPackagePath("../linux-arm64", out _));
    }

    [Fact]
    public void ServerWithoutPackagesListsNone()
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["OnboardPackages:Path"] = "/nonexistent/onboard-packages" })
            .Build();
        var service = new OnboardPackageService(new FixedBuildInfo(), configuration, NullLogger<OnboardPackageService>.Instance);
        Assert.Empty(service.GetManifest().Packages);
    }

    private static void Install(ReleaseLayout layout, string name)
    {
        Directory.CreateDirectory(layout.ReleaseDirectory(name));
        File.WriteAllText(Path.Combine(layout.ReleaseDirectory(name), ReleaseLayout.EntryAssembly), "");
    }

    private sealed class FixedBuildInfo : IServerBuildInfoService
    {
        public ServerBuildInfo GetBuildInfo() => new("master", New);
    }

    private sealed class TempDirectory : IDisposable
    {
        public string Path { get; } = Directory.CreateTempSubdirectory("signalrc-update-").FullName;
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
