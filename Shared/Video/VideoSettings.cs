namespace LteCar.Shared.Video;

/// <summary>
/// Video setting to be sent to the car for configuring / starting the video stream.
/// </summary>
public class VideoSettings : IVideoSettings
{
    public static VideoSettings Default => new VideoSettings
    {
        Width = 640,
        Height = 480,
        Framerate = 22,
        Bitrate = 1500,
        Brightness = 0,
    };

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
    public StreamProtocol Protocol { get; set; }
    public int TargetPort { get; set; }
    public string Encoding { get; set; } = "H264";
    public string JanusServer { get; set; } = string.Empty;
}
