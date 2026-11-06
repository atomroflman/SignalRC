using Microsoft.Extensions.Logging;
using SignalRC.Shared.Security;

namespace SignalRC.Onboard;

// SECURITY: the device key proves to the server that this connection is the vehicle
// (Docs/VehicleKeyAuth.md). Unlike ssh_key it MUST NEVER leave the onboard: no LAN
// listener, no hub method, no REST call may hand out device_key. Only signatures of
// server nonces and the public key leave the vehicle.
public class DeviceKeyService
{
    private readonly ConfigLoader _configLoader;
    private readonly ILogger<DeviceKeyService> _logger;
    private readonly object _lock = new();
    private byte[]? _privateKey;
    private string? _publicKey;

    public DeviceKeyService(ConfigLoader configLoader, ILogger<DeviceKeyService> logger)
    {
        _configLoader = configLoader;
        _logger = logger;
    }

    /// <summary>Base64 SPKI of the device key; creates the key pair on first use.</summary>
    public string PublicKey
    {
        get
        {
            EnsureKey();
            return _publicKey!;
        }
    }

    public string Sign(string nonce)
    {
        EnsureKey();
        return VehicleKeys.SignWithDeviceKey(_privateKey!, nonce);
    }

    /// <summary>Base64 SPKI of the owner key (ssh_key.pub), or null if the onboard has none.</summary>
    public string? OwnerPublicKey =>
        File.Exists(_configLoader.SshPublicKeyPath) ? Convert.ToBase64String(File.ReadAllBytes(_configLoader.SshPublicKeyPath)) : null;

    private void EnsureKey()
    {
        if (_privateKey != null) return;
        lock (_lock)
        {
            if (_privateKey != null) return;
            var privatePath = _configLoader.DeviceKeyPath;
            var publicPath = _configLoader.DevicePublicKeyPath;
            if (File.Exists(privatePath))
            {
                _privateKey = File.ReadAllBytes(privatePath);
                using var ecdsa = System.Security.Cryptography.ECDsa.Create();
                ecdsa.ImportPkcs8PrivateKey(_privateKey, out _);
                _publicKey = Convert.ToBase64String(ecdsa.ExportSubjectPublicKeyInfo());
            }
            else
            {
                var (pkcs8, spki) = VehicleKeys.CreateDeviceKey();
                Directory.CreateDirectory(Path.GetDirectoryName(privatePath)!);
                WritePrivate(privatePath, pkcs8);
                File.WriteAllBytes(publicPath, spki);
                _privateKey = pkcs8;
                _publicKey = Convert.ToBase64String(spki);
                _logger.LogInformation("Device key created. Fingerprint {Fingerprint}", VehicleKeys.Fingerprint(_publicKey));
            }
        }
    }

    private static void WritePrivate(string path, byte[] bytes)
    {
        if (OperatingSystem.IsWindows())
        {
            File.WriteAllBytes(path, bytes);
            return;
        }
        // Owner read/write only, set before the key is written.
        using var stream = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.CreateNew,
            Access = FileAccess.Write,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        });
        stream.Write(bytes);
    }
}
