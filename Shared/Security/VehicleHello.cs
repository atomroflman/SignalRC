namespace SignalRC.Shared.Security;

/// <summary>
/// The signed handshake of an onboard (Docs/VehicleKeyAuth.md): the vehicle proves
/// with its device key that it is the vehicle behind <see cref="CarIdentityKey"/>.
/// </summary>
public class VehicleHello
{
    public string CarIdentityKey { get; set; } = string.Empty;
    public string ChannelMapHash { get; set; } = string.Empty;
    /// <summary>Device public key, Base64 SPKI (ECDSA P-256).</summary>
    public string DevicePublicKey { get; set; } = string.Empty;
    /// <summary>The nonce from GetVehicleNonce on this connection.</summary>
    public string Nonce { get; set; } = string.Empty;
    /// <summary>Signature of <see cref="Nonce"/> with the device key, Base64.</summary>
    public string Signature { get; set; } = string.Empty;
}

/// <summary>How the server treats a vehicle connection.</summary>
public static class VehicleAuthState
{
    /// <summary>Signed in with its device key: full vehicle connection.</summary>
    public const string Authenticated = "authenticated";
    /// <summary>No device sign-in (old onboard): version report and self-update only.</summary>
    public const string UpdateOnly = "updateOnly";
    /// <summary>Signed with a device key other than the stored one: update mode until the key is reset in the database.</summary>
    public const string KeyConflict = "keyConflict";
}
