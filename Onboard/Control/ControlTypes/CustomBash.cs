// filepath: /home/greg-e/SignalRC/Onboard/Control/ControlTypes/CustomBash.cs
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging;

namespace SignalRC.Onboard.Control.ControlTypes;

[ControlType("CustomBash")]
public class CustomBash : ControlTypeBase
{
    private readonly ILogger<CustomBash> _logger;
    private bool _lastOn;

    /// <summary>Shell command run on the rising edge (0 → 1) of the control value.</summary>
    public string Command { get; set; } = string.Empty;

    public CustomBash(ILogger<CustomBash> logger)
    {
        _logger = logger;
    }

    public override string ToString() => $"CustomBash@{Address}";

    // Executes the command from the mapped Command property on the rising edge (0 -> 1).
    public override void OnControlRecived(decimal newValue)
    {
        var rounded = Math.Round(newValue);
        var isOn = rounded != 0;

        // rising edge detection
        if (!_lastOn && isOn)
        {
            if (!string.IsNullOrWhiteSpace(Command))
            {
                Observe(ExecuteCommandAsync(Command));
            }
            else
            {
                _logger?.LogWarning("No command configured (Command property empty) for control {Name} at address {Address}", Name, Address);
            }
        }

        _lastOn = isOn;
    }

    public override void OnControlReleased()
    {
        // no action on release
    }

    private async Task ExecuteCommandAsync(string command)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "/bin/bash",
                Arguments = "-c " + EscapeForBash(command),
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = Process.Start(psi);
            if (proc == null)
                throw new InvalidOperationException($"Failed to start process for command: {command}");

            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();

            await proc.WaitForExitAsync();

            var stdout = await stdoutTask;
            var stderr = await stderrTask;

            if (!string.IsNullOrWhiteSpace(stdout))
                _logger?.LogInformation("Command stdout: {Output}", stdout.Trim());
            if (!string.IsNullOrWhiteSpace(stderr))
                _logger?.LogWarning("Command stderr: {Error}", stderr.Trim());
            // Observed by the caller: a failing command shows at the channel.
            if (proc.ExitCode != 0)
                throw new InvalidOperationException($"Command exited with {proc.ExitCode}" +
                    (string.IsNullOrWhiteSpace(stderr) ? "" : $": {stderr.Trim()}"));
        }
        catch (Exception ex)
        {
            _logger?.LogError(ex, "Exception while executing command");
            throw;
        }
    }

    private static string EscapeForBash(string s)
    {
        // Wrap in single quotes and escape existing single quotes: ' -> '\'' which is achieved by replacing ' with '\'' sequence
        return "'" + s.Replace("'", "'\"'\"'") + "'";
    }
}