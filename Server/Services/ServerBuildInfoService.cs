using System.Reflection;

namespace LteCar.Server.Services;

public interface IServerBuildInfoService
{
    ServerBuildInfo GetBuildInfo();
}

public sealed record ServerBuildInfo(string Branch, string? Commit);

public class ServerBuildInfoService : IServerBuildInfoService
{
    private const string ResourceName = "LteCar.Server.Generated.server-build-info.txt";
    private readonly Lazy<ServerBuildInfo> _buildInfo;

    public ILogger<ServerBuildInfoService> Logger { get; }

    public ServerBuildInfoService(ILogger<ServerBuildInfoService> logger)
    {
        Logger = logger;
        _buildInfo = new Lazy<ServerBuildInfo>(LoadBuildInfo);
    }

    public ServerBuildInfo GetBuildInfo() => _buildInfo.Value;

    private ServerBuildInfo LoadBuildInfo()
    {
        try
        {
            using var stream = typeof(ServerBuildInfoService).Assembly.GetManifestResourceStream(ResourceName);
            if (stream == null)
            {
                Logger.LogWarning("Embedded build info resource '{ResourceName}' was not found", ResourceName);
                return new ServerBuildInfo("master", null);
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

            return new ServerBuildInfo(branch, commit);
        }
        catch (Exception ex)
        {
            Logger.LogWarning(ex, "Failed to load embedded server build info");
            return new ServerBuildInfo("master", null);
        }
    }
}
