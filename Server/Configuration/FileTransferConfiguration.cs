using System.ComponentModel.DataAnnotations;

namespace SignalRC.Server.Configuration;

public class FileTransferConfiguration
{
    public const string SectionName = "FileTransfer";

    [Range(1, 10240)]
    public int ThrottleKBytesPerSecond { get; set; } = 20;

    public string StoragePath { get; set; } = "/var/data/signalrc";

    [Range(1, 10240)]
    public int MaxFileSizeMB { get; set; } = 100;
}
