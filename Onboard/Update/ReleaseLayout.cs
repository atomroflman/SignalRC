using System.Runtime.InteropServices;

namespace SignalRC.Onboard.Update;

/// <summary>
/// The release layout on the vehicle (Docs/OnboardAutoUpdate.md):
/// <code>
/// Onboard/current -> releases/&lt;commit12&gt;
/// Onboard/releases/&lt;commit12&gt;/        one published onboard each
/// Onboard/releases/.download/           ZIPs while downloading
/// Onboard/releases/.state/pending       commit/previous/attempts of an unconfirmed release
/// Onboard/releases/.state/blocked       commits that were rolled back, one per line
/// Onboard/releases/.state/last-rollback commit of the last rollback, until reported
/// </code>
/// Releases are never written to once installed: a new one goes next to the running one
/// and <see cref="SwitchCurrent"/> swaps the symlink atomically, so the running process
/// keeps its files. scripts/onboard-prestart.sh reads and writes the same state files.
/// </summary>
public class ReleaseLayout
{
    public const int CommitLength = 12;
    public const string EntryAssembly = "SignalRC.Onboard.dll";

    public string OnboardDirectory { get; }
    public string ReleasesDirectory { get; }
    public string CurrentLink { get; }
    public string DownloadDirectory { get; }
    public string StateDirectory { get; }
    public string PendingFile => Path.Combine(StateDirectory, "pending");
    public string BlockedFile => Path.Combine(StateDirectory, "blocked");
    public string LastRollbackFile => Path.Combine(StateDirectory, "last-rollback");

    public ReleaseLayout(string onboardDirectory)
    {
        OnboardDirectory = Path.GetFullPath(onboardDirectory);
        ReleasesDirectory = Path.Combine(OnboardDirectory, "releases");
        CurrentLink = Path.Combine(OnboardDirectory, "current");
        DownloadDirectory = Path.Combine(ReleasesDirectory, ".download");
        StateDirectory = Path.Combine(ReleasesDirectory, ".state");
    }

    /// <summary>Release folder name for a commit: its first <see cref="CommitLength"/> characters.</summary>
    public static string ReleaseName(string commit) =>
        commit.Length <= CommitLength ? commit : commit[..CommitLength];

    public string ReleaseDirectory(string name) => Path.Combine(ReleasesDirectory, name);

    public bool HasRelease(string name) => File.Exists(Path.Combine(ReleaseDirectory(name), EntryAssembly));

    /// <summary>
    /// The release this process runs from, or null when it does not run through
    /// <see cref="CurrentLink"/> or a release folder (dotnet run, old bin/Release layout).
    /// Read once at startup, before any switch.
    /// </summary>
    public string? ResolveRunningRelease(string baseDirectory)
    {
        var dir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(baseDirectory));
        if (string.Equals(dir, CurrentLink, StringComparison.Ordinal))
            return ReadCurrent();
        if (string.Equals(Path.GetDirectoryName(dir), ReleasesDirectory, StringComparison.Ordinal))
            return Path.GetFileName(dir);
        return null;
    }

    /// <summary>The release <see cref="CurrentLink"/> points to, null without the link.</summary>
    public string? ReadCurrent()
    {
        var info = new FileInfo(CurrentLink);
        var target = info.LinkTarget;
        return target == null ? null : Path.GetFileName(Path.TrimEndingDirectorySeparator(target));
    }

    /// <summary>Points <see cref="CurrentLink"/> at <paramref name="name"/> with one rename(2), so it is never missing.</summary>
    public void SwitchCurrent(string name)
    {
        if (!HasRelease(name))
            throw new InvalidOperationException($"Release {name} is not installed.");
        var temp = CurrentLink + ".new";
        // A leftover link from an interrupted switch; File.Delete unlinks it without following.
        if (new FileInfo(temp).LinkTarget != null || File.Exists(temp))
            File.Delete(temp);
        // Relative, so the checkout can move.
        File.CreateSymbolicLink(temp, Path.Combine("releases", name));
        if (Rename(temp, CurrentLink) != 0)
            throw new IOException($"rename {temp} -> {CurrentLink} failed (errno {Marshal.GetLastPInvokeError()})");
    }

    [DllImport("libc", EntryPoint = "rename", SetLastError = true)]
    private static extern int Rename(string oldPath, string newPath);

    /// <summary>Removes leftovers of an update that did not finish (partial downloads stay to be resumed).</summary>
    public void CleanTemporary()
    {
        if (!Directory.Exists(ReleasesDirectory)) return;
        foreach (var dir in Directory.EnumerateDirectories(ReleasesDirectory, "*.tmp"))
            Directory.Delete(dir, recursive: true);
    }

    /// <summary>Installed releases, newest first (by the time the folder was installed).</summary>
    public IReadOnlyList<string> ListReleases()
    {
        if (!Directory.Exists(ReleasesDirectory)) return Array.Empty<string>();
        return Directory.EnumerateDirectories(ReleasesDirectory)
            .Select(d => new DirectoryInfo(d))
            .Where(d => !d.Name.StartsWith('.') && !d.Name.EndsWith(".tmp", StringComparison.Ordinal))
            .OrderByDescending(d => d.LastWriteTimeUtc)
            .Select(d => d.Name)
            .ToList();
    }

    /// <summary>
    /// Deletes all but the <paramref name="keepPrevious"/> newest releases besides the
    /// current one. Never deletes <paramref name="protectedNames"/>.
    /// </summary>
    public IReadOnlyList<string> Prune(int keepPrevious, params string?[] protectedNames)
    {
        var keep = new HashSet<string>(protectedNames.Where(n => n != null)!, StringComparer.Ordinal);
        var current = ReadCurrent();
        if (current != null) keep.Add(current);
        var removed = new List<string>();
        var previousKept = 0;
        foreach (var name in ListReleases())
        {
            if (keep.Contains(name)) continue;
            if (previousKept < keepPrevious) { previousKept++; continue; }
            Directory.Delete(ReleaseDirectory(name), recursive: true);
            removed.Add(name);
        }
        return removed;
    }

    public PendingRelease? ReadPending() => File.Exists(PendingFile) ? PendingRelease.Parse(File.ReadAllText(PendingFile)) : null;

    public void WritePending(PendingRelease pending)
    {
        Directory.CreateDirectory(StateDirectory);
        WriteAtomically(PendingFile, pending.Format());
    }

    public void ClearPending() => File.Delete(PendingFile);

    public IReadOnlySet<string> ReadBlocked() => File.Exists(BlockedFile)
        ? File.ReadAllLines(BlockedFile).Select(l => l.Trim()).Where(l => l.Length > 0).ToHashSet(StringComparer.Ordinal)
        : new HashSet<string>();

    public void ClearBlocked() => File.Delete(BlockedFile);

    /// <summary>Commit of a rollback the prestart script did and the onboard has not reported yet.</summary>
    public string? TakeLastRollback()
    {
        if (!File.Exists(LastRollbackFile)) return null;
        var commit = File.ReadAllText(LastRollbackFile).Trim();
        File.Delete(LastRollbackFile);
        return commit.Length == 0 ? null : commit;
    }

    private static void WriteAtomically(string path, string content)
    {
        var temp = path + ".new";
        File.WriteAllText(temp, content);
        File.Move(temp, path, overwrite: true);
    }
}

/// <summary>
/// An installed release that has not been confirmed yet. The format is key=value lines so
/// the prestart script can read it without jq.
/// </summary>
public sealed record PendingRelease(string Commit, string? Previous, int Attempts)
{
    public string Format() => $"commit={Commit}\nprevious={Previous ?? ""}\nattempts={Attempts}\n";

    public static PendingRelease? Parse(string text)
    {
        var values = text.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(line => line.Split('=', 2))
            .Where(parts => parts.Length == 2)
            .ToDictionary(parts => parts[0], parts => parts[1]);
        if (!values.TryGetValue("commit", out var commit) || commit.Length == 0) return null;
        values.TryGetValue("previous", out var previous);
        values.TryGetValue("attempts", out var attemptsText);
        int.TryParse(attemptsText, out var attempts);
        return new PendingRelease(commit, string.IsNullOrEmpty(previous) ? null : previous, attempts);
    }
}
