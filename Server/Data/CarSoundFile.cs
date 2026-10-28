namespace SignalRC.Server.Data;

/// <summary>
/// A file of a car's sound library (played by SoundPlayer control channels). The content lives in the
/// database: it is small, needs no extra volume and survives container rebuilds.
/// </summary>
public class CarSoundFile : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;

    public string FileName { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public long SizeBytes { get; set; }
    public string Sha256 { get; set; } = string.Empty;
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public byte[] Data { get; set; } = Array.Empty<byte>();
}
