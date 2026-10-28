using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Audio;

/// <summary>
/// One file of a car's sound library (played by SoundPlayer control channels). The server holds the
/// files; the Onboard keeps a local copy and downloads what is missing or changed (by hash).
/// </summary>
[MessagePackObject]
public class SoundFileInfo
{
    /// <summary>Plain file name, unique per car, e.g. "horn.mp3".</summary>
    [Key(0)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;

    /// <summary>Lowercase hex SHA-256 of the content.</summary>
    [Key(1)][JsonPropertyName("sha256")] public string Sha256 { get; set; } = string.Empty;

    [Key(2)][JsonPropertyName("sizeBytes")] public long SizeBytes { get; set; }

    /// <summary>Largest chunk the server hands out per GetSoundFileChunk call.</summary>
    public const int MaxChunkBytes = 128 * 1024;

    /// <summary>Upload limit per file.</summary>
    public const long MaxFileBytes = 20L * 1024 * 1024;

    public static readonly string[] AllowedExtensions = [".mp3", ".wav", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".aac", ".webm"];

    /// <summary>
    /// True for a plain file name without path parts or odd characters — the only names the server
    /// stores and the Onboard writes to disk.
    /// </summary>
    public static bool IsValidName(string? name) =>
        !string.IsNullOrWhiteSpace(name)
        && name.Length <= 100
        && name == name.Trim()
        && !name.StartsWith('.')
        && name.All(c => char.IsAsciiLetterOrDigit(c) || c is ' ' or '.' or '_' or '-' or '(' or ')')
        && AllowedExtensions.Contains(Path.GetExtension(name).ToLowerInvariant());
}
