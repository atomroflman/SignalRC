using MessagePack;

namespace LteCar.Shared.FileTransfer;

[MessagePackObject]
public class FileReadyNotification
{
    [Key(0)]
    public string Token { get; set; } = string.Empty;

    [Key(1)]
    public string FileName { get; set; } = string.Empty;

    [Key(2)]
    public long FileSizeBytes { get; set; }

    [Key(3)]
    public string Sha256Hash { get; set; } = string.Empty;
}
