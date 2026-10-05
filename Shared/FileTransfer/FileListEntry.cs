using MessagePack;

namespace LteCar.Shared.FileTransfer;

[MessagePackObject]
public class FileListEntry
{
    [Key(0)]
    public string Name { get; set; } = string.Empty;

    [Key(1)]
    public string FullPath { get; set; } = string.Empty;

    [Key(2)]
    public bool IsDirectory { get; set; }

    [Key(3)]
    public long SizeBytes { get; set; }

    [Key(4)]
    public DateTime? LastModifiedUtc { get; set; }
}
