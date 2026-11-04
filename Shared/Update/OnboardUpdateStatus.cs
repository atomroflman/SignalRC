using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Update;

/// <summary>
/// Where the onboard's self-update stands. The onboard sends it after every (re)connect
/// and whenever it changes; the server keeps the latest one per connected car and pushes
/// it to the browsers. See Docs/OnboardAutoUpdate.md.
/// </summary>
[MessagePackObject]
public class OnboardUpdateStatus
{
    /// <summary>Updates are off: AutoUpdate.Enabled is false, or the onboard does not run from a release layout.</summary>
    public const string Disabled = "disabled";
    public const string UpToDate = "upToDate";
    /// <summary>A newer package exists, but a driver holds the control session.</summary>
    public const string WaitingForDriver = "waitingForDriver";
    /// <summary>A newer package exists, but only a driver may start it (AutoUpdate.Enabled is false).</summary>
    public const string Available = "available";
    public const string Downloading = "downloading";
    public const string Installing = "installing";
    public const string Restarting = "restarting";
    public const string Failed = "failed";
    /// <summary>The new release did not come up and the previous one runs again; <see cref="TargetCommit"/> is blocked.</summary>
    public const string RolledBack = "rolledBack";
    /// <summary>The server's commit was rolled back before and is not installed automatically again.</summary>
    public const string Blocked = "blocked";
    /// <summary>The server offers no package for this architecture.</summary>
    public const string NoPackage = "noPackage";
    /// <summary>The package needs a .NET runtime the onboard does not have; <see cref="Message"/> names it.</summary>
    public const string RuntimeMissing = "runtimeMissing";

    [Key(0)][JsonPropertyName("state")] public string State { get; set; } = Disabled;
    [Key(1)][JsonPropertyName("autoUpdateEnabled")] public bool AutoUpdateEnabled { get; set; }
    /// <summary>Commit the onboard updates to, or the one that was rolled back or blocked.</summary>
    [Key(2)][JsonPropertyName("targetCommit")] public string? TargetCommit { get; set; }
    /// <summary>0–100 while <see cref="Downloading"/>.</summary>
    [Key(3)][JsonPropertyName("progressPercent")] public int? ProgressPercent { get; set; }
    /// <summary>Failure reason, missing runtime or why updates are disabled.</summary>
    [Key(4)][JsonPropertyName("message")] public string? Message { get; set; }
    /// <summary>True when a driver may start the update from the GUI right now.</summary>
    [Key(5)][JsonPropertyName("canUpdateManually")] public bool CanUpdateManually { get; set; }
    [Key(6)][JsonPropertyName("changedAtUtc")] public DateTime ChangedAtUtc { get; set; }
}

/// <summary>Answer to a driver's "update now".</summary>
[MessagePackObject]
public class OnboardUpdateRequestResult
{
    [Key(0)][JsonPropertyName("accepted")] public bool Accepted { get; set; }
    /// <summary>Why the request was refused.</summary>
    [Key(1)][JsonPropertyName("message")] public string? Message { get; set; }

    public static OnboardUpdateRequestResult Accept() => new() { Accepted = true };
    public static OnboardUpdateRequestResult Refuse(string message) => new() { Accepted = false, Message = message };
}
