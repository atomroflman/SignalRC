using System.Security.Cryptography;
using System.Text;

namespace SignalRC.Shared.Security;

/// <summary>
/// The two keys of a vehicle (Docs/VehicleKeyAuth.md):
/// <list type="bullet">
/// <item>Owner key (<c>ssh_key</c>, RSA): the private part is with the owner in the
/// browser, the vehicle keeps the public part. Master of every change.</item>
/// <item>Device key (<c>device_key</c>, ECDSA P-256): never leaves the onboard;
/// the vehicle signs server nonces with it to prove it is the vehicle.</item>
/// </list>
/// Public keys travel as Base64 SubjectPublicKeyInfo (SPKI DER), signatures as Base64.
/// Signed data is the UTF-8 text of the nonce.
/// </summary>
public static class VehicleKeys
{
    /// <summary>Upper bound for a Base64 public key we accept (RSA 4096 SPKI is ~740 chars).</summary>
    public const int MaxPublicKeyLength = 2048;

    // -- Device key -----------------------------------------------------------------

    public static (byte[] Pkcs8, byte[] Spki) CreateDeviceKey()
    {
        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        return (ecdsa.ExportPkcs8PrivateKey(), ecdsa.ExportSubjectPublicKeyInfo());
    }

    public static string SignWithDeviceKey(byte[] pkcs8, string data)
    {
        using var ecdsa = ECDsa.Create();
        ecdsa.ImportPkcs8PrivateKey(pkcs8, out _);
        return Convert.ToBase64String(ecdsa.SignData(Encoding.UTF8.GetBytes(data), HashAlgorithmName.SHA256));
    }

    public static bool VerifyDeviceSignature(string? spkiBase64, string? data, string? signatureBase64)
    {
        if (!TryDecode(spkiBase64, out var spki) || data == null || !TryDecode(signatureBase64, out var signature))
            return false;
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(spki, out _);
            return ecdsa.VerifyData(Encoding.UTF8.GetBytes(data), signature, HashAlgorithmName.SHA256);
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    public static bool IsDevicePublicKey(string? spkiBase64)
    {
        if (!TryDecode(spkiBase64, out var spki)) return false;
        try
        {
            using var ecdsa = ECDsa.Create();
            ecdsa.ImportSubjectPublicKeyInfo(spki, out _);
            return true;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    // -- Owner key ------------------------------------------------------------------

    /// <summary>Same check as the onboard's SshKeyService: RSA PKCS#1 v1.5 with SHA-256 (WebCrypto RSASSA-PKCS1-v1_5).</summary>
    public static bool VerifyOwnerSignature(string? spkiBase64, string? data, string? signatureBase64)
    {
        if (!TryDecode(spkiBase64, out var spki) || data == null || !TryDecode(signatureBase64, out var signature))
            return false;
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportSubjectPublicKeyInfo(spki, out _);
            return rsa.VerifyData(Encoding.UTF8.GetBytes(data), signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    public static bool IsOwnerPublicKey(string? spkiBase64)
    {
        if (!TryDecode(spkiBase64, out var spki)) return false;
        try
        {
            using var rsa = RSA.Create();
            rsa.ImportSubjectPublicKeyInfo(spki, out _);
            return rsa.KeySize >= 2048;
        }
        catch (CryptographicException)
        {
            return false;
        }
    }

    // -- Both -----------------------------------------------------------------------

    /// <summary>SHA-256 of the SPKI bytes, lower-case hex; what logs and the UI show.</summary>
    public static string Fingerprint(string spkiBase64) =>
        Convert.ToHexString(SHA256.HashData(Convert.FromBase64String(spkiBase64))).ToLowerInvariant();

    private static bool TryDecode(string? base64, out byte[] bytes)
    {
        bytes = [];
        if (string.IsNullOrEmpty(base64) || base64.Length > MaxPublicKeyLength * 2) return false;
        try
        {
            bytes = Convert.FromBase64String(base64);
            return bytes.Length > 0;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
