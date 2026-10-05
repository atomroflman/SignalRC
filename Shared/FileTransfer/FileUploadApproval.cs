using MessagePack;

namespace LteCar.Shared.FileTransfer;

[MessagePackObject]
public class FileUploadApproval
{
    [Key(0)]
    public string Token { get; set; } = string.Empty;
}
