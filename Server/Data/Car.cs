using System.ComponentModel.DataAnnotations;

namespace SignalRC.Server.Data;

public class Car : EntityBase
{
    public string? Name { get; set; }
    public string CarIdentityKey { get; set; } = string.Empty;
    public string ChannelMapHash { get; set; } = string.Empty;
    public DateTime LastSeen { get; set; } = DateTime.Now;

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
    public ICollection<CarChannel> Functions { get; set; } = new List<CarChannel>();
    public ICollection<UserCarSetup> UserCarSetups { get; set; } = new List<UserCarSetup>();
    public ICollection<CarVideoStream> VideoStreams { get; set; } = new List<CarVideoStream>();
    public ICollection<CarPinManager> PinManagers { get; set; } = new List<CarPinManager>();

    public override string ToString()
    {
        return $"{Name ?? CarIdentityKey} (ID: {Id})";
    }
}