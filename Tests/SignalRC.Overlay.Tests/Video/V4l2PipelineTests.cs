using SignalRC.Onboard;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Video;

// The USB webcam's runOnInit: ffmpeg by default, GStreamer with "pipeline":"gstreamer".
public class V4l2PipelineTests
{
    private static VideoStreamMapItem Stream(Dictionary<string, object>? options = null) => new()
    {
        StreamId = "cam", Type = "usb", Width = 1280, Height = 720, Framerate = 22, Bitrate = 1500000,
        Options = options ?? new(),
    };

    [Fact]
    public void Ffmpeg_stays_the_default()
    {
        var cmd = MediaMtxConfigurator.V4l2RunOnInit(Stream(new() { ["inputFormat"] = "mjpeg", ["hwEncoder"] = true }), "/dev/video2", "10.0.0.1", 10000);
        Assert.StartsWith("ffmpeg ", cmd);
        Assert.Contains("-c:v h264_v4l2m2m", cmd);
        Assert.EndsWith("-f rtp rtp://10.0.0.1:10000?pkt_size=1300", cmd);
    }

    [Fact]
    public void Gstreamer_decodes_mjpeg_and_encodes_on_the_soc()
    {
        var cmd = MediaMtxConfigurator.V4l2RunOnInit(Stream(new() { ["pipeline"] = "GStreamer" }), "/dev/video2", "10.0.0.1", 10000);
        Assert.Equal(
            "gst-launch-1.0 -q v4l2src device=/dev/video2 ! image/jpeg,width=1280,height=720,parsed=true"
            + " ! videorate drop-only=true ! image/jpeg,framerate=22/1 ! v4l2jpegdec"
            + " ! v4l2h264enc extra-controls=controls,repeat_sequence_header=1,video_bitrate=1500000,h264_i_frame_period=22"
            + " ! video/x-h264,profile=(string)constrained-baseline,level=(string)4"
            + " ! rtph264pay config-interval=-1 pt=96 mtu=1300 ! udpsink host=10.0.0.1 port=10000 sync=false",
            cmd);
    }

    [Fact]
    public void Gstreamer_feeds_raw_yuyv_straight_into_the_encoder()
    {
        var cmd = MediaMtxConfigurator.V4l2RunOnInit(Stream(new() { ["pipeline"] = "gstreamer", ["inputFormat"] = "yuyv422" }), "/dev/video2", "h", 1);
        Assert.Contains("v4l2src device=/dev/video2 ! video/x-raw,format=YUY2,width=1280,height=720 ! videorate drop-only=true ! video/x-raw,format=YUY2,framerate=22/1 ! v4l2h264enc", cmd);
        Assert.DoesNotContain("v4l2jpegdec", cmd);
    }

    [Fact]
    public void Gstreamer_without_size_framerate_and_bitrate_leaves_them_to_the_camera()
    {
        var stream = new VideoStreamMapItem { StreamId = "cam", Type = "usb", Options = new() { ["pipeline"] = "gstreamer" } };
        var cmd = MediaMtxConfigurator.V4l2RunOnInit(stream, "/dev/video0", "h", 1);
        Assert.Contains("v4l2src device=/dev/video0 ! image/jpeg,parsed=true ! v4l2jpegdec", cmd);
        Assert.Contains("extra-controls=controls,repeat_sequence_header=1,h264_i_frame_period=30 ", cmd);
        Assert.DoesNotContain("videorate", cmd);
    }

    [Fact]
    public void Camera_h264_falls_back_to_ffmpeg()
    {
        var cmd = MediaMtxConfigurator.V4l2RunOnInit(Stream(new() { ["pipeline"] = "gstreamer", ["inputFormat"] = "h264" }), "/dev/video2", "h", 1);
        Assert.StartsWith("ffmpeg ", cmd);
    }
}
