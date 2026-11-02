namespace SignalRC.Shared.Channels;

public enum TelemetryDataType
{
    String = 0,
    Integer = 1,
    Number = 2,
    Boolean = 3,
    /// <summary>Compact LiDAR grid as plain text (Shared/Overlay/lidar/README.md §5).</summary>
    LidarGrid = 4,
}
