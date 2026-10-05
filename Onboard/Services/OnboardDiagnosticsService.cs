using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using LteCar.Shared.HubClients;
using LteCar.Shared.Video;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard;

public class OnboardDiagnosticsService : IDiagnosticsClient
{
    private readonly ILogger<OnboardDiagnosticsService> _logger;

    public OnboardDiagnosticsService(ILogger<OnboardDiagnosticsService> logger)
    {
        _logger = logger;
    }

    public Task<OnboardDiagnosticsReport> GetOnboardDiagnostics()
    {
        var report = RunDiagnostics(startTest: false);
        return Task.FromResult(report);
    }

    public Task<OnboardDiagnosticsReport> RunOnboardStartupTest()
    {
        var report = RunDiagnostics(startTest: true);
        return Task.FromResult(report);
    }

    private OnboardDiagnosticsReport RunDiagnostics(bool startTest = false)
    {
        var scriptPath = FindScriptPath();
        if (string.IsNullOrEmpty(scriptPath))
        {
            return ErrorReport("Diagnose-Script nicht gefunden", "Onboard/Tools/video_stack_check.py konnte nicht lokalisiert werden.");
        }

        _logger.LogInformation("Running onboard diagnostics via {Script} (startTest={StartTest})", scriptPath, startTest);

        try
        {
            var args = $"\"{scriptPath}\" --json";
            if (startTest)
            {
                args += " --start-test";
            }

            var psi = new ProcessStartInfo
            {
                FileName = "python3",
                Arguments = args,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            using var process = Process.Start(psi);
            if (process == null)
            {
                return ErrorReport("Prozessstart fehlgeschlagen", "Konnte python3 nicht starten.");
            }

            var stdout = process.StandardOutput.ReadToEnd();
            var stderr = process.StandardError.ReadToEnd();
            process.WaitForExit();

            if (!string.IsNullOrWhiteSpace(stderr))
            {
                _logger.LogWarning("Diagnostics script stderr: {Stderr}", stderr);
            }

            if (string.IsNullOrWhiteSpace(stdout))
            {
                return ErrorReport("Keine Diagnose-Ausgabe", $"python3 beendete sich mit Code {process.ExitCode} und lieferte keine Ausgabe. Stderr: {stderr}");
            }

            // The script prints the JSON report as the last line. Filter out any preceding log lines.
            var jsonLine = stdout.Split(new[] { '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries)
                .LastOrDefault(line => line.TrimStart().StartsWith("{"));

            if (string.IsNullOrEmpty(jsonLine))
            {
                return ErrorReport("Kein JSON in Ausgabe", $"Script-Ausgabe enthielt kein JSON:\n{stdout}");
            }

            var report = JsonSerializer.Deserialize<OnboardDiagnosticsReport>(jsonLine, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });

            if (report == null)
            {
                return ErrorReport("JSON-Deserialisierung fehlgeschlagen", "Das Diagnose-Script lieferte keinen gültigen Report.");
            }

            report.Timestamp = DateTime.UtcNow;
            return report;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to run onboard diagnostics");
            return ErrorReport("Ausnahme bei der Diagnose", ex.Message);
        }
    }

    private static string? FindScriptPath()
    {
        var assemblyLocation = Assembly.GetExecutingAssembly().Location;
        var assemblyDir = Path.GetDirectoryName(assemblyLocation);

        // Published layout: Tools/video_stack_check.py next to the assembly
        if (!string.IsNullOrEmpty(assemblyDir))
        {
            var published = Path.Combine(assemblyDir, "Tools", "video_stack_check.py");
            if (File.Exists(published))
            {
                return published;
            }
        }

        // Development layout: running from bin/Debug/net10.0, script is two/three dirs up under Onboard/Tools
        var candidates = new[]
        {
            Path.Combine("Onboard", "Tools", "video_stack_check.py"),
            Path.Combine("..", "..", "..", "Onboard", "Tools", "video_stack_check.py"),
            Path.Combine("..", "..", "Onboard", "Tools", "video_stack_check.py"),
        };

        foreach (var candidate in candidates)
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(full))
            {
                return full;
            }
        }

        return null;
    }

    private static OnboardDiagnosticsReport ErrorReport(string title, string message)
    {
        return new OnboardDiagnosticsReport
        {
            Timestamp = DateTime.UtcNow,
            StreamName = "",
            HasErrors = true,
            Checks = new List<DiagnosticCheck>
            {
                new()
                {
                    Step = "0",
                    Title = title,
                    Status = DiagnosticStatus.Error,
                    Message = message,
                }
            }
        };
    }
}
