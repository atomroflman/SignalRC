using System.Text.Json;
using SignalRC.Onboard;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Video;

public class SensorModeTests
{
    private static VideoStreamMapItem Stream(object? mode)
    {
        var stream = new VideoStreamMapItem { StreamId = "cam" };
        if (mode != null) stream.Options["sensorMode"] = mode;
        return stream;
    }

    [Fact]
    public void No_option_means_no_mode()
        => Assert.Null(MediaMtxConfigurator.SensorMode(Stream(null)));

    [Theory]
    [InlineData("2304:1296:10:P")]
    [InlineData("2304:1296:10")]
    [InlineData("4608:2592")]
    public void Valid_modes_pass_through(string mode)
        => Assert.Equal(mode, MediaMtxConfigurator.SensorMode(Stream(mode)));

    [Fact]
    public void Value_from_json_options_is_read()
        => Assert.Equal("2304:1296:10:P",
            MediaMtxConfigurator.SensorMode(Stream(JsonDocument.Parse("\" 2304:1296:10:P \"").RootElement)));

    [Theory]
    [InlineData("")]
    [InlineData("2304x1296")]
    [InlineData("2304:1296\"\n    runOnInit: rm -rf /")]
    public void Invalid_values_are_dropped(string mode)
        => Assert.Null(MediaMtxConfigurator.SensorMode(Stream(mode)));
}
