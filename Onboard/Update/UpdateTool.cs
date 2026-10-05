using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Spectre.Console;
using LteCar.Onboard.Services;

namespace LteCar.Onboard.Update;

// ponytail: minimal "pull + publish + restart" for an Onboard Pi running as a systemd service.
// Run via `dotnet run -- update`. Steps:
//   1. git pull --rebase --autostash in the repo root
//   2. dotnet publish to /opt/ltecar/onboard
//   3. sudo systemctl restart ltecar-onboard (best-effort; skipped when service is absent)
//
// No auto-update on connect — that's a separate decision. This tool is the user-triggered half
// of the "sync Onboard with Server" flow that pairs with the Server-side version endpoint.
public static class UpdateTool
{
    private static readonly string PublishDir = "/opt/ltecar/onboard";
    private const string ServiceName = "ltecar-onboard";

    public static async Task<int> RunAsync(string configDir)
    {
        var repoRoot = ResolveRepoRoot();
        if (repoRoot is null)
        {
            AnsiConsole.MarkupLine("[red]Could not locate the LteCar repo root (no .git found above cwd).[/]");
            AnsiConsole.MarkupLine("[grey]Run this from inside a LteCar checkout or pass --config-dir=<repo>.[/]");
            return 1;
        }

        var buildInfo = new OnboardBuildInfoService(NullLogger<OnboardBuildInfoService>.Instance).GetBuildInfo();
        AnsiConsole.MarkupLine($"[grey]Current build: {buildInfo.Branch}@{Shorten(buildInfo.Commit)}[/]");
        AnsiConsole.MarkupLine($"[grey]Repo root    : {repoRoot}[/]");
        AnsiConsole.MarkupLine($"[grey]Publish dir  : {PublishDir}[/]");
        AnsiConsole.WriteLine();

        var step = 1;
        if (!await RunStep(step++, "git pull --rebase --autostash", repoRoot,
                $"git -C {Quote(repoRoot)} pull --rebase --autostash")) return 1;

        if (!await RunStep(step++, "dotnet publish (Onboard)", repoRoot,
                $"dotnet publish Onboard/LteCar.Onboard.csproj -c Release -o {Quote(PublishDir)} /p:BuildInfoBranch={Quote(buildInfo.Branch)} /p:UseAppHost=false")) return 1;

        if (await ServiceExistsAsync())
        {
            if (!await RunStep(step++, "systemctl restart", null,
                    $"sudo systemctl restart {ServiceName}")) return 1;
        }
        else
        {
            AnsiConsole.MarkupLine($"[yellow]systemd service '{ServiceName}' not found — skipping restart. Start the new build manually from {PublishDir}.[/]");
        }

        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine("[green]Update complete.[/]");
        return 0;
    }

    private static string? ResolveRepoRoot()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, ".git")))
                return dir.FullName;
            dir = dir.Parent;
        }
        return null;
    }

    private static async Task<bool> RunStep(int step, string title, string? workingDir, string commandLine)
    {
        AnsiConsole.MarkupLine($"[bold][[{step}]] {Markup.Escape(title)}[/]");
        AnsiConsole.MarkupLine($"[grey]$ {Markup.Escape(commandLine)}[/]");

        var psi = new ProcessStartInfo("bash", $"-lc {Quote(commandLine)}")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        if (workingDir is not null) psi.WorkingDirectory = workingDir;

        using var proc = Process.Start(psi)!;
        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();

        var stdout = await stdoutTask;
        var stderr = await stderrTask;
        if (!string.IsNullOrWhiteSpace(stdout)) AnsiConsole.WriteLine(stdout.TrimEnd());
        if (!string.IsNullOrWhiteSpace(stderr)) AnsiConsole.MarkupLine($"[red]{Markup.Escape(stderr.TrimEnd())}[/]");

        if (proc.ExitCode != 0)
        {
            AnsiConsole.MarkupLine($"[red]Step {step} failed (exit {proc.ExitCode}).[/]");
            return false;
        }
        AnsiConsole.MarkupLine($"[green]Step {step} OK.[/]");
        AnsiConsole.WriteLine();
        return true;
    }

    private static async Task<bool> ServiceExistsAsync()
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo("systemctl", $"list-unit-files {ServiceName}.service")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            })!;
            var output = await proc.StandardOutput.ReadToEndAsync();
            await proc.WaitForExitAsync();
            return proc.ExitCode == 0 && output.Contains($"{ServiceName}.service", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static string Quote(string value) => $"'{value.Replace("'", "'\\''")}'";

    private static string Shorten(string? commit) =>
        string.IsNullOrEmpty(commit) || commit.Length < 8 ? commit ?? "?" : commit[..8];
}

internal sealed class NullLogger<T> : ILogger<T>
{
    public static readonly NullLogger<T> Instance = new();
    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
    public bool IsEnabled(LogLevel logLevel) => false;
    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) { }
}