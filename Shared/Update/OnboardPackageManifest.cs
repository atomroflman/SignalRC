using System.Text.Json.Serialization;

namespace SignalRC.Shared.Update;

/// <summary>
/// What GET /api/onboard/packages returns: the onboard packages the server image was built
/// with, one per runtime identifier. Branch and commit are the server's own, since server
/// and packages come from the same build.
/// </summary>
public class OnboardPackageManifest
{
    [JsonPropertyName("branch")] public string Branch { get; set; } = string.Empty;
    [JsonPropertyName("commit")] public string? Commit { get; set; }
    /// <summary>Keyed by runtime identifier, e.g. "linux-arm64". Empty when the server has no packages.</summary>
    [JsonPropertyName("packages")] public Dictionary<string, OnboardPackageInfo> Packages { get; set; } = new();
}

public class OnboardPackageInfo
{
    /// <summary>Server-relative download path.</summary>
    [JsonPropertyName("url")] public string Url { get; set; } = string.Empty;
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = string.Empty;
    [JsonPropertyName("size")] public long Size { get; set; }
    /// <summary>Microsoft.NETCore.App version the package targets, e.g. "10.0.0".</summary>
    [JsonPropertyName("framework")] public string? Framework { get; set; }
}
