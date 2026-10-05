using LteCar.Shared.FileTransfer;

namespace LteCar.Server.Data;

public class FileTransfer : EntityBase
{
    public int CarId { get; set; }
    public Car Car { get; set; } = null!;

    public int? UploadedByUserId { get; set; }
    public User? UploadedByUser { get; set; }

    public string FileName { get; set; } = string.Empty;
    public string? ContentType { get; set; }
    public long FileSizeBytes { get; set; }
    public string Sha256Hash { get; set; } = string.Empty;
    public string StoragePath { get; set; } = string.Empty;
    public string? TargetPath { get; set; }

    public FileTransferStatus Status { get; set; } = FileTransferStatus.Uploading;

    public string DownloadToken { get; set; } = Guid.NewGuid().ToString("N");

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedAt { get; set; }
}
