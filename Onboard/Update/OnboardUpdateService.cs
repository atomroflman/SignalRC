using System.Net.Http.Json;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Services;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Update;

namespace SignalRC.Onboard.Update;

/// <summary>
/// Self-update from the server's packages (Docs/OnboardAutoUpdate.md). After every
/// handshake it confirms a freshly installed release, compares its build with the
/// server's and, if allowed, downloads the package, installs it next to the running
/// release, switches <c>Onboard/current</c> and exits; systemd starts the new release.
/// A release that does not come up is rolled back by scripts/onboard-prestart.sh.
/// </summary>
public class OnboardUpdateService : IOnboardUpdateClient
{
    private const int KeepPreviousReleases = 3;
    private static readonly TimeSpan WaitingRecheckInterval = TimeSpan.FromSeconds(30);

    private readonly IConfiguration _configuration;
    private readonly ServerConnectionService _connection;
    private readonly ControlService _control;
    private readonly IOnboardBuildInfoService _buildInfo;
    private readonly ILogger<OnboardUpdateService> _logger;
    private readonly ReleaseLayout _layout;
    private readonly ReleaseInstaller _installer;
    private readonly string? _runningRelease;
    private readonly HttpClient _http = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly Timer _waitingTimer;

    private OnboardUpdateStatus _status = new() { ChangedAtUtc = DateTime.UtcNow };
    private UpdateVerdict? _lastVerdict;
    private string? _rolledBackCommit;
    private volatile bool _installing;
    private Timer? _confirmWatchdog;

    public OnboardUpdateService(
        IConfiguration configuration,
        ServerConnectionService connection,
        ControlService control,
        IOnboardBuildInfoService buildInfo,
        ConfigLoader configLoader,
        ILogger<OnboardUpdateService> logger)
    {
        _configuration = configuration;
        _connection = connection;
        _control = control;
        _buildInfo = buildInfo;
        _logger = logger;
        _layout = new ReleaseLayout(configLoader.ConfigDir);
        _runningRelease = _layout.ResolveRunningRelease(AppContext.BaseDirectory);
        _installer = new ReleaseInstaller(_http, _layout, logger);
        _waitingTimer = new Timer(_ => _ = RecheckWhileWaitingAsync(), null, Timeout.Infinite, Timeout.Infinite);
        _control.SessionChanged += () => _ = RecheckWhileWaitingAsync();
    }

    private bool AutoUpdateEnabled => _configuration.GetValue("AutoUpdate:Enabled", false);
    private TimeSpan ConfirmTimeout => TimeSpan.FromMinutes(_configuration.GetValue("AutoUpdate:ConfirmTimeoutMinutes", 10));

    /// <summary>True while this process runs an installed release that has not reached the server yet.</summary>
    public bool IsUnconfirmed => _runningRelease != null && _layout.ReadPending()?.Commit == _runningRelease;

    /// <summary>
    /// Called once at startup, before connecting. Cleans up after an interrupted update and,
    /// for an unconfirmed release, ends the process if it never reaches the server: that
    /// counts as a failed start for the rollback.
    /// </summary>
    public void Initialize()
    {
        if (_runningRelease == null)
        {
            _logger.LogInformation("Onboard does not run from the release layout ({BaseDirectory}); self-update is off.", AppContext.BaseDirectory);
            return;
        }
        _logger.LogInformation("Running release {Release}. Auto-update {State}.", _runningRelease, AutoUpdateEnabled ? "enabled" : "disabled");
        try { _layout.CleanTemporary(); }
        catch (Exception ex) { _logger.LogWarning(ex, "Could not remove leftovers of an earlier update"); }

        var pending = _layout.ReadPending();
        if (pending?.Commit != _runningRelease) return;
        var timeout = ConfirmTimeout;
        _logger.LogWarning("Release {Release} is not confirmed yet (start {Attempt}); it has {Timeout} to reach the server.",
            _runningRelease, pending.Attempts, timeout);
        _confirmWatchdog = new Timer(_ =>
        {
            if (!IsUnconfirmed) return;
            _logger.LogCritical("Release {Release} did not reach the server within {Timeout}; exiting so the rollback can count it.", _runningRelease, timeout);
            Environment.Exit(1);
        }, null, timeout, Timeout.InfiniteTimeSpan);
    }

    /// <summary>Called after every successful OpenCarConnection handshake.</summary>
    public async Task OnHandshakeAsync()
    {
        if (_runningRelease != null)
        {
            ConfirmRunningRelease();
            var rolledBack = _layout.TakeLastRollback();
            if (rolledBack != null)
            {
                _rolledBackCommit = rolledBack;
                _logger.LogError("Release {Commit} did not come up and was rolled back; running {Release} again.", rolledBack, _runningRelease);
            }
        }
        await CheckAsync();
    }

    private void ConfirmRunningRelease()
    {
        var pending = _layout.ReadPending();
        if (pending == null || pending.Commit != _runningRelease) return;
        _layout.ClearPending();
        _confirmWatchdog?.Dispose();
        _logger.LogInformation("Release {Release} confirmed after reaching the server.", _runningRelease);
        try
        {
            foreach (var removed in _layout.Prune(KeepPreviousReleases, pending.Previous))
                _logger.LogInformation("Removed old release {Release}", removed);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not remove old releases");
        }
    }

    /// <summary>Compares with the server and installs if the rules allow it without asking.</summary>
    public async Task CheckAsync()
    {
        if (_installing || !await _gate.WaitAsync(0)) return;
        try
        {
            var verdict = await EvaluateAsync();
            if (verdict == null) return;
            if (verdict.InstallAutomatically)
            {
                _installing = true;
                _ = Task.Run(() => InstallAsync(verdict, manual: false));
                return;
            }
            _waitingTimer.Change(verdict.State == OnboardUpdateStatus.WaitingForDriver ? WaitingRecheckInterval : Timeout.InfiniteTimeSpan, WaitingRecheckInterval);
            await ReportAsync(verdict.State, verdict.TargetCommit, message: verdict.Message, canUpdateManually: verdict.CanUpdateManually);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task RecheckWhileWaitingAsync()
    {
        if (_lastVerdict?.State == OnboardUpdateStatus.WaitingForDriver && !_control.HasLiveSession)
            await CheckAsync();
    }

    public async Task<OnboardUpdateRequestResult> StartOnboardUpdate(string sessionId)
    {
        if (!_control.IsActiveSession(sessionId))
            return OnboardUpdateRequestResult.Refuse("Nur der Fahrer mit aktiver Steuersitzung kann das Update starten.");
        if (_installing)
            return OnboardUpdateRequestResult.Refuse("Das Update läuft bereits.");
        if (!await _gate.WaitAsync(TimeSpan.FromSeconds(10)))
            return OnboardUpdateRequestResult.Refuse("Das Onboard prüft gerade auf Updates, bitte gleich nochmal versuchen.");
        try
        {
            var verdict = await EvaluateAsync();
            if (verdict == null)
                return OnboardUpdateRequestResult.Refuse("Der Server ist nicht erreichbar.");
            if (!verdict.CanUpdateManually && !verdict.InstallAutomatically)
                return OnboardUpdateRequestResult.Refuse(verdict.Message ?? "Es gibt keinen neueren Stand.");

            _logger.LogWarning("Driver started the onboard update to {Commit}.", verdict.TargetCommit);
            _installing = true;
            _control.LockForUpdate();
            _ = Task.Run(() => InstallAsync(verdict, manual: true));
            return OnboardUpdateRequestResult.Accept();
        }
        finally
        {
            _gate.Release();
        }
    }

    // Browser broadcast; nothing to do on the onboard.
    public Task OnboardUpdateStatusChanged(int carId, OnboardUpdateStatus status) => Task.CompletedTask;

    /// <summary>Gathers the inputs and decides; null when the server's manifest could not be read.</summary>
    private async Task<UpdateVerdict?> EvaluateAsync()
    {
        OnboardPackageManifest? manifest;
        try
        {
            var builder = _connection.GetServerUriBuilder();
            builder.Path = "/api/onboard/packages";
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            manifest = await _http.GetFromJsonAsync<OnboardPackageManifest>(builder.Uri, timeout.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not read the onboard package manifest");
            return null;
        }
        if (manifest == null) return null;

        var blocked = _layout.ReadBlocked();
        // The block holds only until the server builds something else.
        if (blocked.Count > 0 && manifest.Commit != null && !blocked.Contains(ReleaseLayout.ReleaseName(manifest.Commit)))
        {
            _layout.ClearBlocked();
            blocked = new HashSet<string>();
        }

        var build = _buildInfo.GetBuildInfo();
        var verdict = UpdateDecision.Decide(new UpdateInputs(
            build.Branch,
            build.Commit,
            _runningRelease,
            manifest,
            CurrentRuntimeIdentifier(),
            AutoUpdateEnabled,
            blocked,
            InstalledRuntimes(),
            _control.HasLiveSession));

        if (verdict.State == OnboardUpdateStatus.Blocked && _rolledBackCommit != null
            && verdict.TargetCommit != null && ReleaseLayout.ReleaseName(verdict.TargetCommit) == ReleaseLayout.ReleaseName(_rolledBackCommit))
            verdict = verdict with { State = OnboardUpdateStatus.RolledBack };

        _lastVerdict = verdict;
        _logger.LogInformation("Update check: local {Branch}@{Commit}, server {ServerBranch}@{ServerCommit} -> {State}",
            build.Branch, Short(build.Commit), manifest.Branch, Short(manifest.Commit), verdict.State);
        return verdict;
    }

    private async Task InstallAsync(UpdateVerdict verdict, bool manual)
    {
        var target = verdict.TargetCommit!;
        var name = ReleaseLayout.ReleaseName(target);
        try
        {
            if (!_layout.HasRelease(name))
            {
                var builder = _connection.GetServerUriBuilder();
                builder.Path = verdict.Package!.Url;
                await _installer.InstallAsync(builder.Uri, verdict.Package, name,
                    percent => percent < 100
                        ? ReportAsync(OnboardUpdateStatus.Downloading, target, progress: percent)
                        : ReportAsync(OnboardUpdateStatus.Installing, target));
            }
            else
            {
                await ReportAsync(OnboardUpdateStatus.Installing, target);
                _logger.LogInformation("Release {Release} is already installed; switching to it.", name);
            }

            // A driver may have taken over while downloading; the automatic update yields.
            if (!manual && _control.HasLiveSession)
            {
                _logger.LogInformation("A driver connected during the download; release {Release} waits.", name);
                _installing = false;
                _lastVerdict = verdict with { State = OnboardUpdateStatus.WaitingForDriver, CanUpdateManually = true };
                _waitingTimer.Change(WaitingRecheckInterval, WaitingRecheckInterval);
                await ReportAsync(OnboardUpdateStatus.WaitingForDriver, target, canUpdateManually: true);
                return;
            }

            if (!manual) _control.LockForUpdate();
            _layout.WritePending(new PendingRelease(name, _runningRelease, 0));
            _layout.SwitchCurrent(name);
            _logger.LogWarning("Switched to release {Release} (was {Previous}); restarting.", name, _runningRelease);
            await ReportAsync(OnboardUpdateStatus.Restarting, target);
            await RestartAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Onboard update to {Commit} failed", target);
            _installing = false;
            if (_control.IsLockedForUpdate)
                await _control.UnlockAfterFailedUpdateAsync();
            await ReportAsync(OnboardUpdateStatus.Failed, target, message: ex.Message, canUpdateManually: true);
        }
    }

    /// <summary>Leaves the server cleanly and exits; Restart=always brings up the new release.</summary>
    private async Task RestartAsync()
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            if (_connection.IsConnected)
                await _connection.Connection.StopAsync(timeout.Token);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Could not close the server connection before restarting");
        }
        _logger.LogWarning("Exiting for the restart into the new release.");
        Environment.Exit(0);
    }

    private async Task ReportAsync(string state, string? target, int? progress = null, string? message = null, bool canUpdateManually = false)
    {
        _status = new OnboardUpdateStatus
        {
            State = state,
            AutoUpdateEnabled = AutoUpdateEnabled,
            TargetCommit = target,
            ProgressPercent = progress,
            Message = message,
            CanUpdateManually = canUpdateManually && !_installing,
            ChangedAtUtc = DateTime.UtcNow,
        };
        if (!_connection.IsConnected) return;
        try
        {
            await _connection.GetProxy().ReportOnboardUpdateStatus(_status);
        }
        catch (Exception ex)
        {
            // Older servers don't know the method; the update itself does not depend on it.
            _logger.LogDebug(ex, "Could not report the update status");
        }
    }

    private static string? CurrentRuntimeIdentifier() => RuntimeInformation.OSArchitecture switch
    {
        Architecture.Arm64 => "linux-arm64",
        Architecture.X64 => "linux-x64",
        _ => null,
    };

    /// <summary>Microsoft.NETCore.App versions next to the dotnet that runs this process.</summary>
    private static IReadOnlyCollection<Version> InstalledRuntimes()
    {
        var versions = new List<Version>();
        var root = Environment.GetEnvironmentVariable("DOTNET_ROOT");
        if (string.IsNullOrEmpty(root) && Environment.ProcessPath is { } processPath)
            root = Path.GetDirectoryName(processPath);
        var shared = root == null ? null : Path.Combine(root, "shared", "Microsoft.NETCore.App");
        if (shared != null && Directory.Exists(shared))
        {
            foreach (var dir in Directory.EnumerateDirectories(shared))
                if (UpdateDecision.TryParseVersion(Path.GetFileName(dir), out var version))
                    versions.Add(version);
        }
        // At least the runtime this process runs on is there.
        if (versions.Count == 0) versions.Add(Environment.Version);
        return versions;
    }

    private static string Short(string? commit) =>
        string.IsNullOrEmpty(commit) || commit.Length < 8 ? commit ?? "?" : commit[..8];
}
