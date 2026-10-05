using System.Text.Json.Serialization;
using LteCar.Shared.Video;
using MessagePack;

namespace LteCar.Shared.Channels;

/// <summary>
/// ConfigMap item for a video stream.
/// </summary>
[MessagePackObject]
public class VideoStreamMapItem
{
    [Key(0)]
    [JsonPropertyName("name")] 
    public string? Name { get; set; }
    [Key(1)]
    [JsonPropertyName("location")] 
    public string? Location { get; set; }
    [Key(2)]
    [JsonPropertyName("type")] 
    public string? Type { get; set; }
    [Key(3)]
    [JsonPropertyName("streamId")] 
    public required string StreamId { get; set; }
    [Key(4)]
    [JsonPropertyName("enabled")] 
    public bool Enabled { get; set; } = true;
    [Key(5)]
    [JsonPropertyName("serverId")] 
    public int? ServerId { get; set; }

    [Key(6)]
    [JsonPropertyName("cameraDevice")]
    public string? CameraDevice { get; set; }

    [Key(7)]
    [JsonPropertyName("rpiCamId")]
    [MediaMtxName("rpiCameraCamID")]
    public int? RpiCamId { get; set; }

    [Key(8)]
    [MediaMtxName("rpiCameraWidth")]
    [JsonPropertyName("width")]
    public int? Width { get; set; }

    [Key(9)]
    [MediaMtxName("rpiCameraHeight")]
    [JsonPropertyName("height")]
    public int? Height { get; set; }

    [Key(10)]
    [JsonPropertyName("framerate")]
    [MediaMtxName("rpiCameraFPS")]
    public int? Framerate { get; set; }

    [Key(11)]
    [JsonPropertyName("bitrate")]
    [MediaMtxName("rpiCameraBitrate")]    
    public int? Bitrate { get; set; }

    [Key(12)]
    [JsonPropertyName("modifiedAt")]
    public DateTime? ModifiedAt { get; set; }

    [Key(13)]
    [JsonPropertyName("options")]
    public Dictionary<string, object> Options { get; set; } = new();

    [Key(14)]
    [JsonPropertyName("gain")]
    [MediaMtxName("rpiCameraGain")]
    public float? Gain { get; set; }

    [Key(15)]
    [JsonPropertyName("shutter")]
    [MediaMtxName("rpiCameraShutter")]
    public int? Shutter { get; set; }

    [Key(16)]
    [JsonPropertyName("brightness")]
    [MediaMtxName("rpiCameraBrightness")]
    public float? Brightness { get; set; }

    [Key(17)]
    [JsonPropertyName("contrast")]
    [MediaMtxName("rpiCameraContrast")]    
    public float? Contrast { get; set; }

    [Key(18)]
    [JsonPropertyName("ev")]
    [MediaMtxName("rpiCameraEV")]
    public float? EV { get; set; }

    [Key(19)]
    [JsonPropertyName("exposure")]
    [MediaMtxName("rpiCameraExposure")]
    public string? Exposure { get; set; }

    [Key(20)]
    [JsonPropertyName("port")]
    public int Port {get;set;}
}
