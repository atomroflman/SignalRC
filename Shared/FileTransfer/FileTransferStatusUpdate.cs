using MessagePack;

namespace LteCar.Shared.FileTransfer;

[MessagePackObject]
public class FileTransferStatusUpdate
{
    [Key(0)]
    public string Token { get; set; } = string.Empty;

    [Key(1)]
    public FileTransferStatus Status { get; set; }

    [Key(2)]
    public string? Sha256Hash { get; set; }
}
