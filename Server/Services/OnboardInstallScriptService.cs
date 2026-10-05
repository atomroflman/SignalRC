using Microsoft.Extensions.Primitives;
using System.Net;

namespace LteCar.Server.Services;

public interface IOnboardInstallScriptService
{
    OnboardInstallCommandInfo BuildOnboardInstallCommand(HttpRequest request);
    string BuildOnboardInstallScript(HttpRequest request);
}

public sealed record OnboardInstallCommandInfo(
    string Command,
    string ScriptUrl,
    string ServerName,
    int ServerPort,
    bool UseHttps,
    string ServerUrl,
    string Branch,
    string? GitRef);

public class OnboardInstallScriptService : IOnboardInstallScriptService
{
    public IWebHostEnvironment HostEnvironment { get; }
    public ILogger<OnboardInstallScriptService> Logger { get; }
    public IServerBuildInfoService ServerBuildInfoService { get; }

    public OnboardInstallScriptService(
        IWebHostEnvironment hostEnvironment,
        ILogger<OnboardInstallScriptService> logger,
        IServerBuildInfoService serverBuildInfoService)
    {
        HostEnvironment = hostEnvironment;
        Logger = logger;
        ServerBuildInfoService = serverBuildInfoService;
    }

    public OnboardInstallCommandInfo BuildOnboardInstallCommand(HttpRequest request)
    {
        var settings = ResolveServerSettings(request);
        var resolvedBranch = ResolveBranch();
        var resolvedGitRef = ResolveGitRef();
        var scriptUrl = BuildScriptUrl(settings, resolvedBranch);
        var command = $"curl -fsSL {QuoteForShell(scriptUrl)} | sudo bash";

        return new OnboardInstallCommandInfo(
            command,
            scriptUrl,
            settings.ServerName,
            settings.ServerPort,
            settings.UseHttps,
            BuildServerUrl(settings),
            resolvedBranch,
            resolvedGitRef);
    }

    public string BuildOnboardInstallScript(HttpRequest request)
    {
        var settings = ResolveServerSettings(request);
        var resolvedBranch = ResolveBranch();
        var resolvedGitRef = ResolveGitRef();
        var serverUrl = BuildServerUrl(settings);
        var templatePath = GetInstallScriptPath();

        if (!File.Exists(templatePath))
            throw new FileNotFoundException("install.sh template not found", templatePath);

        var template = File.ReadAllText(templatePath);
        var gitRefLine = string.IsNullOrWhiteSpace(resolvedGitRef)
            ? string.Empty
            : $"LTECAR_GIT_REF='{EscapeForSingleQuotes(resolvedGitRef)}'{Environment.NewLine}";

        Logger.LogInformation(
            "Generating onboard install script for {ServerName}:{ServerPort} (HTTPS: {UseHttps}, Branch: {Branch}, GitRef: {GitRef})",
            settings.ServerName,
            settings.ServerPort,
            settings.UseHttps,
            resolvedBranch,
            resolvedGitRef ?? "n/a");

        return $$"""
#!/bin/bash
# Sourced from: {{templatePath}}
DEPLOY_MODE='onboard'
LTECAR_SERVER_URL='{{EscapeForSingleQuotes(serverUrl)}}'
LTECAR_SERVER_NAME='{{EscapeForSingleQuotes(settings.ServerName)}}'
LTECAR_SERVER_PORT='{{settings.ServerPort}}'
LTECAR_USE_HTTPS='{{settings.UseHttps.ToString().ToLowerInvariant()}}'
LTECAR_BRANCH='{{EscapeForSingleQuotes(resolvedBranch)}}'
{{gitRefLine}}
{{template}}
""";
    }

    private string BuildScriptUrl(ServerConnectionSettings settings, string branch)
    {
        var builder = new UriBuilder
        {
            Scheme = settings.UseHttps ? "https" : "http",
            Host = settings.ServerName,
            Port = settings.ServerPort,
            Path = "/api/install/onboard.sh"
        };

        return builder.Uri.ToString();
    }

    private static string BuildServerUrl(ServerConnectionSettings settings)
    {
        var builder = new UriBuilder
        {
            Scheme = settings.UseHttps ? "https" : "http",
            Host = settings.ServerName,
            Port = settings.ServerPort
        };

        return builder.Uri.ToString().TrimEnd('/');
    }

    private string GetInstallScriptPath()
    {
        // The template must be resolvable both inside the published container
        // (/app/install.sh) and during local development (repo-root/install.sh).
        var candidates = new[]
        {
            Path.Combine(HostEnvironment.ContentRootPath, "install.sh"),
            Path.Combine(Path.GetFullPath(Path.Combine(HostEnvironment.ContentRootPath, "..")), "install.sh"),
            "/install.sh"
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
                return candidate;
        }

        // Fall back to the container path so the FileNotFoundException message is useful.
        return candidates[0];
    }

    private string ResolveBranch()
    {
        var buildInfo = ServerBuildInfoService.GetBuildInfo();
        return string.IsNullOrWhiteSpace(buildInfo.Branch) ? "master" : buildInfo.Branch;
    }

    private string? ResolveGitRef()
    {
        var buildInfo = ServerBuildInfoService.GetBuildInfo();
        return string.IsNullOrWhiteSpace(buildInfo.Commit) ? null : buildInfo.Commit;
    }

    private static ServerConnectionSettings ResolveServerSettings(HttpRequest request)
    {
        var forwardedProto = GetFirstHeaderValue(request.Headers, "X-Forwarded-Proto");
        var forwardedHost = GetFirstHeaderValue(request.Headers, "X-Forwarded-Host");
        var forwardedPort = GetFirstHeaderValue(request.Headers, "X-Forwarded-Port");

        var scheme = string.IsNullOrWhiteSpace(forwardedProto)
            ? request.Scheme
            : forwardedProto;
        var useHttps = string.Equals(scheme, "https", StringComparison.OrdinalIgnoreCase);

        var hostValue = string.IsNullOrWhiteSpace(forwardedHost)
            ? request.Host.Value
            : forwardedHost;
        var host = string.IsNullOrWhiteSpace(hostValue)
            ? request.Host
            : new HostString(hostValue);

        var serverPort = int.TryParse(forwardedPort, out var parsedPort)
            ? parsedPort
            : host.Port ?? (useHttps ? 443 : 80);
        var serverName = ResolveServerName(host.Host);

        return new ServerConnectionSettings(serverName, serverPort, useHttps);
    }

    private static string ResolveServerName(string? hostName)
    {
        if (!string.IsNullOrWhiteSpace(hostName)
            && !string.Equals(hostName, "localhost", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(hostName, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(hostName, "::1", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(hostName, "[::1]", StringComparison.OrdinalIgnoreCase))
        {
            return hostName;
        }

        try
        {
            var systemHostName = Dns.GetHostName();
            if (!string.IsNullOrWhiteSpace(systemHostName))
            {
                return systemHostName;
            }
        }
        catch
        {
        }

        return "localhost";
    }

    private static string? GetFirstHeaderValue(IHeaderDictionary headers, string key)
    {
        if (!headers.TryGetValue(key, out StringValues values))
            return null;

        return values.ToString()
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
    }

    private static string QuoteForShell(string value) => $"'{EscapeForSingleQuotes(value)}'";

    private static string EscapeForSingleQuotes(string value) => value.Replace("'", "'\"'\"'");

    private sealed record ServerConnectionSettings(string ServerName, int ServerPort, bool UseHttps);
}
