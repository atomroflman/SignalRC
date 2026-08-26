using MessagePack;

namespace SignalRC.Shared;

/// <summary>
/// SSH-based authentication request for acquiring car control
/// </summary>
[MessagePackObject]
public class SshAuthenticationRequest
{
    /// <summary>
    /// Challenge string provided by the server
    /// </summary>
    [Key(0)]
    public string Challenge { get; set; } = string.Empty;

    /// <summary>
    /// Signature of the challenge, signed with the vehicle's private SSH key
    /// </summary>
    [Key(1)]
    public string Signature { get; set; } = string.Empty;
}

