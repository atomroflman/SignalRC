using System.Reflection;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard.Services;

public interface IOnboardBuildInfoService
{
    OnboardBuildInfo GetBuildInfo();
}

public sealed record OnboardBuildInfo(string Branch, string? Commit);

public class OnboardBuildInfoService : IOnboardBuildInfoService
{
    private const string ResourceName = "LteCar.Onboard.Generated.onboard-build-info.txt";
    private readonly Lazy<OnboardBuildInfo> _buildInfo;

    public ILogger<OnboardBuildInfoService> Logger { get; }

    public OnboardBuildInfoService(ILogger<OnboardBuildInfoService> logger)
    {
        Logger = logger;
        _buildInfo = new Lazy<OnboardBuildInfo>(LoadBuildInfo);
    }

    public OnboardBuildInfo GetBuildInfo() => _buildInfo.Value;

    private OnboardBuildInfo LoadBuildInfo()
    {
        try
        {
            using var stream = typeof(OnboardBuildInfoService).Assembly.GetManifestResourceStream(ResourceName);
            if (stream == null)
            {
                Logger.LogWarning("Embedded build info resource '{ResourceName}' was not found", ResourceName);
                return new OnboardBuildInfo("master", null);
            }

            using var reader = new StreamReader(stream);
            var values = reader
                .ReadToEnd()
                .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(line => line.Split('=', 2, StringSplitOptions.TrimEntries))
                .Where(parts => parts.Length == 2)
                .ToDictionary(parts => parts[0], parts => parts[1], StringComparer.OrdinalIgnoreCase);

            var branch = values.TryGetValue("Branch", out var storedBranch)
                && !string.IsNullOrWhiteSpace(storedBranch)
                && !storedBranch.StartsWith("fatal:", StringComparison.OrdinalIgnoreCase)
                ? storedBranch
                : "master";
            var commit = values.TryGetValue("Commit", out var storedCommit)
                && !string.IsNullOrWhiteSpace(storedCommit)
                && storedCommit != "unknown"
                && !storedCommit.StartsWith("fatal:", StringComparison.OrdinalIgnoreCase)
                ? storedCommit
                : null;

            return new OnboardBuildInfo(branch, commit);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to load embedded onboard build info");
            return new OnboardBuildInfo("master", null);
        }
    }
}