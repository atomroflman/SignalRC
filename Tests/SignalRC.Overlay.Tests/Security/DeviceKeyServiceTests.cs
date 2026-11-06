using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard;
using SignalRC.Shared.Security;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>Docs/VehicleKeyAuth.md, S2: the onboard's device key.</summary>
public sealed class DeviceKeyServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "signalrc-devkey-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }

    private DeviceKeyService Service() => new(new ConfigLoader(_dir), NullLogger<DeviceKeyService>.Instance);

    [Fact]
    public void TheKeyIsCreatedOnceKeptPrivateAndSignsVerifiably()
    {
        var first = Service();
        var signature = first.Sign("nonce-1");
        Assert.True(VehicleKeys.VerifyDeviceSignature(first.PublicKey, "nonce-1", signature));
        Assert.False(VehicleKeys.VerifyDeviceSignature(first.PublicKey, "nonce-2", signature));

        var loader = new ConfigLoader(_dir);
        Assert.True(File.Exists(loader.DeviceKeyPath));
        if (!OperatingSystem.IsWindows())
            Assert.Equal(UnixFileMode.UserRead | UnixFileMode.UserWrite, File.GetUnixFileMode(loader.DeviceKeyPath));

        // A restart loads the same key instead of creating a new one.
        Assert.Equal(first.PublicKey, Service().PublicKey);
    }

    [Fact]
    public void TheOwnerPublicKeyIsReadFromSshKeyPub()
    {
        Assert.Null(Service().OwnerPublicKey);
        Directory.CreateDirectory(_dir);
        File.WriteAllBytes(new ConfigLoader(_dir).SshPublicKeyPath, [1, 2, 3]);
        Assert.Equal(Convert.ToBase64String([1, 2, 3]), Service().OwnerPublicKey);
    }
}
