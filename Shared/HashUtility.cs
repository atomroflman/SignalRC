using System.Security.Cryptography;
using System.Text;

namespace SignalRC.Shared;

/// <summary>
/// Utility class for consistent SHA256 hashing across the application
/// </summary>
public static class HashUtility
{
    /// <summary>
    /// Generates a SHA256 hash of the input string as a hexadecimal string (uppercase)
    /// </summary>
    public static string GenerateSha256Hash(string input)
    {
        using var sha256 = SHA256.Create();
        var hashBytes = sha256.ComputeHash(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(hashBytes);
    }

    /// <summary>
    /// Generates a SHA256 hash of the input string as a hexadecimal string (lowercase)
    /// </summary>
    public static string GenerateSha256HashLowercase(string input)
    {
        return GenerateSha256Hash(input).ToLowerInvariant();
    }
}

