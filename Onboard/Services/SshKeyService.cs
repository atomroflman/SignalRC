using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace LteCar.Onboard;

// SECURITY: the Onboard's private SSH key authenticates the driver session
// against this specific vehicle. It MUST stay inside the local network —
// do NOT add any path (SignalR, REST, WebSocket, anything that traverses
// the public-internet Server) that streams `ssh_key` out of the LAN.
// The only supported delivery channel is the LAN-bound HTTP listener on
// port 8080 in Program.cs (binds to "+"), which the browser reaches via
// `http://<vehicle-lan-ip>:8080/ssh-key?hash=...` after the Server has
// confirmed the vehicle's identity hash. Adding a SignalR/Server-routed
// equivalent would expose the key to any browser session the Server's
// auth cookie accepts — out of scope.
public class SshKeyService
{
    private readonly ILogger<SshKeyService> _logger;
    private readonly ConfigLoader _configLoader;
    private readonly IConfiguration _configuration;
    private string _privateKeyPath => _configLoader.SshKeyPath;
    private string _publicKeyPath => _configLoader.SshPublicKeyPath;

    public SshKeyService(ILogger<SshKeyService> logger, ConfigLoader configLoader, IConfiguration configuration)
    {
        _logger = logger;
        _configLoader = configLoader;
        _configuration = configuration;
    }

    public byte[]? GetPublicKey()
    {
        if (File.Exists(_publicKeyPath))
        {
            return File.ReadAllBytes(_publicKeyPath);
        }
        return null;
    }

    public void LogKeyFingerprints()
    {
        try
        {
            if (File.Exists(_publicKeyPath))
            {
                var spki = File.ReadAllBytes(_publicKeyPath);
                using var sha = SHA256.Create();
                var hash = sha.ComputeHash(spki);
                var hex = BitConverter.ToString(hash).Replace("-", string.Empty);
                var b64 = Convert.ToBase64String(hash);
                _logger.LogInformation($"PublicKey(SPKI) SHA256 HEX={hex} B64={b64}");
            }
            else
            {
                _logger.LogWarning("Public key file not found for fingerprint logging.");
            }

            if (File.Exists(_privateKeyPath))
            {
                var pkcs8 = File.ReadAllBytes(_privateKeyPath);
                using var sha = SHA256.Create();
                var hash = sha.ComputeHash(pkcs8);
                var hex = BitConverter.ToString(hash).Replace("-", string.Empty);
                var b64 = Convert.ToBase64String(hash);
                _logger.LogInformation($"PrivateKey(PKCS8) SHA256 HEX={hex} B64={b64}");
            }
            else
            {
                _logger.LogWarning("Private key file not found for fingerprint logging (may have been deleted after download).");
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error while logging key fingerprints");
        }
    }

    public bool VerifySignature(string data, string signature)
    {
        try
        {
            // Use C# RSA with properly imported PEM public key
            if (!File.Exists(_publicKeyPath))
            {
                _logger.LogError("Public key file not found");
                return false;
            }

            // Public key is stored as SPKI DER
            var publicKeyDer = File.ReadAllBytes(_publicKeyPath);
            using var rsa = RSA.Create();
            rsa.ImportSubjectPublicKeyInfo(publicKeyDer, out _);

            var dataBytes = Encoding.UTF8.GetBytes(data);
            var signatureBytes = Convert.FromBase64String(signature);

            var isValid = rsa.VerifyData(dataBytes, signatureBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

            if (isValid)
            {
                _logger.LogInformation("Signature verification succeeded");
            }
            else
            {
                _logger.LogWarning("Signature verification failed - signature does not match");
            }

            return isValid;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error verifying SSH signature");
            return false;
        }
    }


    public string? SignData(string data)
    {
        try
        {
            // Check if private key still exists (if not, it was downloaded and deleted)
            if (!File.Exists(_privateKeyPath))
            {
                _logger.LogError("Private key file not found - key may have been downloaded and deleted.");
                return null;
            }

            // Private key is stored as PKCS#8 DER
            var privateKeyDer = File.ReadAllBytes(_privateKeyPath);
            using var rsa = RSA.Create();
            rsa.ImportPkcs8PrivateKey(privateKeyDer, out _);

            var dataBytes = Encoding.UTF8.GetBytes(data);
            var signatureBytes = rsa.SignData(dataBytes, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);

            return Convert.ToBase64String(signatureBytes);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error signing data with SSH key");
            return null;
        }
    }

    public string? GenerateChallenge()
    {
        // Generate a random challenge for authentication
        return Guid.NewGuid().ToString("N") + DateTime.UtcNow.Ticks.ToString("X");
    }

    public string? GenerateSessionIdFromPrivateKey(string privateKeyPem)
    {
        try
        {
            // Generate a deterministic session ID from the private key
            using var rsa = RSA.Create();
            rsa.ImportFromPem(privateKeyPem);

            // Get the public key bytes for consistent hashing
            var publicKeyBytes = rsa.ExportRSAPublicKey();

            // Create a hash of the public key for consistent session ID
            using var sha256 = SHA256.Create();
            var hashBytes = sha256.ComputeHash(publicKeyBytes);

            // Convert to a shorter, consistent string
            var sessionId = Convert.ToBase64String(hashBytes)[..16]; // First 16 characters

            return sessionId;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error generating session ID from private key");
            return null;
        }
    }
}
