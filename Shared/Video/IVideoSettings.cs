namespace LteCar.Shared.Video;

public interface IVideoSettings
{
    public int Width { get; set; }
    public int Height { get; set; }
    public int Framerate { get; set; }
    public float Brightness { get; set; }
    public int Bitrate { get; set; }
    public float? Gain { get; set; }
    public int? Shutter { get; set; }
    public float? Contrast { get; set; }
    public float? EV { get; set; }
    public string? Exposure { get; set; }
}
