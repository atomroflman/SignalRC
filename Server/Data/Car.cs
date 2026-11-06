using System.ComponentModel.DataAnnotations;

namespace SignalRC.Server.Data;

public class Car : EntityBase
{
    public string? Name { get; set; }
    public string CarIdentityKey { get; set; } = string.Empty;
    public string ChannelMapHash { get; set; } = string.Empty;
    public DateTime LastSeen { get; set; } = DateTime.Now;

    // Docs/VehicleKeyAuth.md: the device key signs the vehicle in (TOFU on the first
    // signed handshake), the owner key is the master of every change and is checked
    // here for config sessions while the vehicle is offline. Reset = set to null in the DB.
    /// <summary>Device public key, Base64 SPKI (ECDSA P-256); null until the first signed handshake.</summary>
    [MaxLength(Shared.Security.VehicleKeys.MaxPublicKeyLength)]
    public string? DevicePublicKey { get; set; }
    [MaxLength(64)]
    public string? DeviceKeyFingerprint { get; set; }
    /// <summary>Owner public key (ssh_key.pub), Base64 SPKI (RSA); reported by the signed-in vehicle.</summary>
    [MaxLength(Shared.Security.VehicleKeys.MaxPublicKeyLength)]
    public string? OwnerPublicKey { get; set; }
    [MaxLength(64)]
    public string? OwnerKeyFingerprint { get; set; }
    public DateTime? OwnerKeyChangedAt { get; set; }

    // Car-level audio, see SignalRC.Shared.Audio.AudioSettings for the meaning of each value.
    /// <summary>ALSA capture device of the vehicle microphone; null hides listening in the UI.</summary>
    [MaxLength(100)]
    public string? AudioInputDevice { get; set; }
    [MaxLength(10)]
    public string AudioInputChannel { get; set; } = "mix";
    public float AudioInputGain { get; set; } = 1f;
    public bool AudioDenoise { get; set; }
    public int AudioBitrateKbps { get; set; } = 32;
    /// <summary>ALSA playback device for push-to-talk and sound channels; null hides push-to-talk in the UI.</summary>
    public string? AudioOutputDevice { get; set; }
    public float AudioOutputVolume { get; set; } = 1f;
    public bool AudioMuteInputWhileTalking { get; set; } = true;
    /// <summary>Days the telemetry history of this car is kept (TelemetryRecorder).</summary>
    public int TelemetryRetentionDays { get; set; } = 7;
    /// <summary>Master switch of the telemetry history: nothing is recorded while set. Only the active driver changes it.</summary>
    public bool TelemetryRecordingStopped { get; set; }
    public ICollection<CarChannel> Functions { get; set; } = new List<CarChannel>();
    public ICollection<UserCarSetup> UserCarSetups { get; set; } = new List<UserCarSetup>();
    public ICollection<CarVideoStream> VideoStreams { get; set; } = new List<CarVideoStream>();
    public ICollection<CarPinManager> PinManagers { get; set; } = new List<CarPinManager>();

    public override string ToString()
    {
        return $"{Name ?? CarIdentityKey} (ID: {Id})";
    }
}