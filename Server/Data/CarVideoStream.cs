using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using LteCar.Shared.Video;
using System.Text.Json;

namespace LteCar.Server.Data;

public class CarVideoStream : EntityBase, IVideoSettings
{
    [Required]
    [MaxLength(50)]
    public string StreamId { get; set; } = string.Empty;

    [Required]
    public int CarId { get; set; }

    [ForeignKey(nameof(CarId))]
    public Car Car { get; set; } = null!;

    // Transport details (existing)
    [Required]
    [MaxLength(10)]
    public StreamProtocol Protocol { get; set; } = StreamProtocol.UDP; // TCP, UDP

    [Required]
    public int Port { get; set; }
    public int? JanusPort { get; set; }

    [Required]
    public DateTime StartTime { get; set; }

    public DateTime? EndTime { get; set; }

    [Required]
    public bool IsActive { get; set; } = true;

    [MaxLength(500)]
    public string? ProcessArguments { get; set; }

    [MaxLength(100)]
    public string? StreamPurpose { get; set; } // "video", "telemetry", "control", etc.

    // Metadata fields (new)
    [Required]
    [MaxLength(100)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Description { get; set; }

    [Required]
    [MaxLength(50)]
    public string Type { get; set; } = string.Empty; // "camera", "sensor", "diagnostic"

    [MaxLength(50)]
    public string? Location { get; set; } // "front", "rear", "left", "right", "interior"

    [Required]
    public int Priority { get; set; } = 1;

    [Required]
    public bool Enabled { get; set; } = false;

    public DateTime LastStatusUpdate { get; set; } = DateTime.UtcNow;

    public int Height { get; set; } = 720;
    public int Width { get; set; } = 1280;
    public int Bitrate { get; set; } = 1_000_000;
    public int Framerate { get; set; } = 30;
    public float Brightness { get; set; } = 0.5f;
    public float? Gain { get; set; }
    public int? Shutter { get; set; }
    public float? Contrast { get; set; }
    public float? EV { get; set; }
    [MaxLength(20)]
    public string? Exposure { get; set; }
    public string? JanusId { get; set; }

    [MaxLength(100)]
    public string? CameraDevice { get; set; }

    public int? RpiCamId { get; set; }

    public string? OptionsJson { get; set; }

    public int? ServerId { get; set; }

    public DateTime? ModifiedAt { get; set; }
}