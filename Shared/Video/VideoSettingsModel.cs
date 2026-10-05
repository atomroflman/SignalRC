namespace LteCar.Shared.Video;

/// <summary>
/// Model for updating video settings from the UI.
/// </summary>
public class VideoSettingsModel
{
    public int Width { get; set; }
    public int Height { get; set; }
    public int Framerate { get; set; }
    public float Brightness { get; set; }
    public int BitrateKbps { get; set; }
    public float? Gain { get; set; }
    public int? Shutter { get; set; }
    public float? Contrast { get; set; }
    public float? EV { get; set; }
    public string? Exposure { get; set; }
    public bool Enabled { get; set; }

    public void ApplySettings(IVideoSettings settings)
    {
        settings.Width = Width;
        settings.Height = Height;
    
        settings.Framerate = Framerate;
        settings.Brightness = Brightness;
    
        settings.Bitrate = BitrateKbps;
        settings.Gain = Gain;
        settings.Shutter = Shutter;
        settings.Contrast = Contrast;
        settings.EV = EV;
        settings.Exposure = Exposure;
    }
}