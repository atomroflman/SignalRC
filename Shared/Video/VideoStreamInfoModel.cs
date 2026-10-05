namespace LteCar.Shared.Video;

public class VideoStreamInfoModel : VideoSettingsModel
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string StreamId { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string? Location { get; set; }
    public int Priority { get; set; }
    public bool IsActive { get; set; }
    public int ViewerCount { get; set; }
}