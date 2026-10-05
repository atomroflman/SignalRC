using MessagePack;

namespace LteCar.Shared.FileTransfer;

[MessagePackObject]
public class ListFilesResponse
{
    [Key(0)]
    public string RequestId { get; set; } = string.Empty;

    [Key(1)]
    public string Path { get; set; } = string.Empty;

    [Key(2)]
    public List<FileListEntry> Entries { get; set; } = new();

    [Key(3)]
    public string? Error { get; set; }
}
