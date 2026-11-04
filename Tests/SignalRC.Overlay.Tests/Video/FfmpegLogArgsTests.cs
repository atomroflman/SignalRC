using System.Text.Json;
using SignalRC.Onboard;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Video;

public class FfmpegLogArgsTests
{
    private static VideoStreamMapItem Stream(object? level)
    {
        var stream = new VideoStreamMapItem { StreamId = "cam" };
        if (level != null) stream.Options["ffmpegLogLevel"] = level;
        return stream;
    }

    [Fact]
    public void Default_is_warning_without_progress()
        => Assert.Equal(" -hide_banner -loglevel warning -nostats", MediaMtxConfigurator.FfmpegLogArgs(Stream(null)));

    [Theory]
    [InlineData("error", " -hide_banner -loglevel error -nostats")]
    [InlineData("INFO", " -hide_banner -loglevel info")]
    [InlineData("debug", " -hide_banner -loglevel debug")]
    public void Known_levels_pass_through(string level, string expected)
        => Assert.Equal(expected, MediaMtxConfigurator.FfmpegLogArgs(Stream(level)));

    [Fact]
    public void Value_from_json_options_is_read()
        => Assert.Equal(" -hide_banner -loglevel info",
            MediaMtxConfigurator.FfmpegLogArgs(Stream(JsonDocument.Parse("\"info\"").RootElement)));

    [Theory]
    [InlineData("warning; rm -rf /")]
    [InlineData("")]
    public void Unknown_values_fall_back_to_the_default(string level)
        => Assert.Equal(" -hide_banner -loglevel warning -nostats", MediaMtxConfigurator.FfmpegLogArgs(Stream(level)));
}
