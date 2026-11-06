using System.Reflection;
using System.Text.Json;
using SignalRC.Server.Controllers;
using SignalRC.Server.Data;
using SignalRC.Server.Services;
using SignalRC.Shared.Channels;
using SignalRC.Shared.Video;

namespace SignalRC.Overlay.Tests.Config;

// Setup page export/import of the whole vehicle configuration.
public class VehicleConfigTests
{
    private static Dictionary<string, object> Options(string json) => JsonSerializer.Deserialize<Dictionary<string, object>>(json)!;

    [Fact]
    public void Control_channel_survives_export_and_import()
    {
        var source = new CarChannel
        {
            ChannelName = "steer", DisplayName = "Lenkung", IsEnabled = true, RequiresAxis = true, MaxResendInterval = 300,
            ControlType = "TrackSteeringControl", PinManager = "can", Address = 3, TestDisabled = true,
            OptionsJson = "{\"invert\":true,\"trim\":0.1}",
        };
        var dto = VehicleConfigMapper.ToDto(source);
        var target = new CarChannel { ChannelName = "steer" };
        VehicleConfigMapper.Apply(target, Roundtrip(dto));
        Assert.True(VehicleConfigMapper.Same(dto, VehicleConfigMapper.ToDto(target)));
    }

    [Fact]
    public void Telemetry_and_video_survive_export_and_import()
    {
        var t = new CarTelemetry { ChannelName = "gear", ReadIntervalTicks = 10, TelemetryType = "FlowValueReader", DataType = TelemetryDataType.Number, Unit = "x", Decimals = 2, PinManager = "", Address = null, OptionsJson = "{\"Key\":\"gear\"}" };
        var tDto = VehicleConfigMapper.ToDto(t);
        var t2 = new CarTelemetry { ChannelName = "gear" };
        VehicleConfigMapper.Apply(t2, Roundtrip(tDto));
        Assert.True(VehicleConfigMapper.Same(tDto, VehicleConfigMapper.ToDto(t2)));

        var v = new CarVideoStream
        {
            StreamId = "front", Name = "Front", Type = "camera", Location = "front", Enabled = true, Width = 640, Height = 480, Framerate = 25,
            Bitrate = 2048, Brightness = 0.6f, Priority = 2, Port = 10010, JanusPort = 10011, Protocol = StreamProtocol.UDP,
            ProcessArguments = "--x", StreamPurpose = "video", Description = "d", CameraDevice = "/dev/video0", RpiCamId = 1, OptionsJson = "{\"hdr\":true}",
        };
        var vDto = VehicleConfigMapper.ToDto(v);
        var v2 = VehicleConfigMapper.NewStream(1, "front", vDto);
        VehicleConfigMapper.Apply(v2, Roundtrip(vDto));
        Assert.True(VehicleConfigMapper.Same(vDto, VehicleConfigMapper.ToDto(v2)));
    }

    [Theory]
    [InlineData(typeof(ControlChannelDto))]
    [InlineData(typeof(TelemetryChannelDto))]
    [InlineData(typeof(VideoStreamDto))]
    [InlineData(typeof(PinManagerDto))]
    public void Export_fills_every_field_the_editor_saves(Type dtoType)
    {
        // A new field in an editor DTO must also be exported, or an import would reset it.
        object dto = dtoType == typeof(ControlChannelDto) ? VehicleConfigMapper.ToDto(new CarChannel { ChannelName = "a", DisplayName = "d", ControlType = "c", PinManager = "p", Address = 1, MaxResendInterval = 1, TestDisabled = true, OptionsJson = "{\"a\":1}" })
            : dtoType == typeof(TelemetryChannelDto) ? VehicleConfigMapper.ToDto(new CarTelemetry { ChannelName = "a", TelemetryType = "t", Unit = "u", Decimals = 1, PinManager = "p", Address = 1, OptionsJson = "{\"a\":1}" })
            : dtoType == typeof(VideoStreamDto) ? VehicleConfigMapper.ToDto(new CarVideoStream { StreamId = "a", Name = "n", Type = "t", Location = "l", JanusPort = 1, ProcessArguments = "x", StreamPurpose = "p", Description = "d", CameraDevice = "c", RpiCamId = 1, OptionsJson = "{\"a\":1}" })
            : VehicleConfigMapper.ToDto(new CarPinManager { Name = "a", Type = "t", OptionsJson = "{\"a\":1}" });
        var missing = dtoType.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.GetValue(dto) == null).Select(p => p.Name).ToList();
        Assert.Empty(missing);
    }

    [Fact]
    public void Compare_sorts_names_into_added_changed_unchanged_missing()
    {
        var current = new Dictionary<string, PinManagerDto>
        {
            ["can"] = new() { Name = "can", Type = "Can", Options = Options("{\"a\":1,\"b\":2}") },
            ["pca"] = new() { Name = "pca", Type = "Pca9685" },
            ["old"] = new() { Name = "old", Type = "X" },
        };
        var imported = new Dictionary<string, PinManagerDto>
        {
            ["can"] = new() { Name = "can", Type = "Can", Options = Options("{\"b\":2,\"a\":1}") }, // order does not matter
            ["pca"] = new() { Name = "pca", Type = "Pca9685", Options = Options("{\"freq\":50}") },
            ["lidar"] = new() { Name = "lidar", Type = "LidarManager" },
        };
        var section = VehicleConfigController.Compare("pinManagers", current, imported);
        Assert.Equal(["lidar"], section.Added);
        Assert.Equal(["pca"], section.Changed);
        Assert.Equal(["can"], section.Unchanged);
        Assert.Equal(["old"], section.Missing);
    }

    [Fact]
    public void Validate_rejects_foreign_files_and_duplicates()
    {
        Assert.Null(VehicleConfigController.Validate(new VehicleConfigFile()));
        Assert.NotNull(VehicleConfigController.Validate(null));
        Assert.NotNull(VehicleConfigController.Validate(new VehicleConfigFile { Format = "other" }));
        Assert.NotNull(VehicleConfigController.Validate(new VehicleConfigFile { Version = 99 }));
        Assert.NotNull(VehicleConfigController.Validate(new VehicleConfigFile { ControlChannels = { new() { ChannelName = "a" }, new() { ChannelName = "a" } } }));
        Assert.NotNull(VehicleConfigController.Validate(new VehicleConfigFile { TelemetryChannels = { new() { ChannelName = " " } } }));
    }

    // Through JSON as the browser sends it back (options become JsonElement).
    private static T Roundtrip<T>(T dto)
    {
        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        return JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(dto, web), web)!;
    }
}
