using System.Buffers;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Protocol;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Services;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Channels;

/// <summary>
/// Option schemas the onboard reports for the options editor of the channel config, and the
/// control option binding they describe.
/// </summary>
public class OptionSchemaTests
{
    private static readonly AvailableChannelTypes Types = new AvailableChannelTypesService().GetAvailableTypes();

    private static ChannelTypeSchema Schema(string kind, string type) =>
        Assert.Single(Types.OptionSchemas, s => s.Kind == kind && s.TypeName == type);

    [Fact]
    public void PinManagersAreListedWithTheirOptionsDefaultsAndDocs()
    {
        Assert.Contains("Pca9685PwmExtension", Types.PinManagerTypes);
        Assert.Contains("CanTrackDriveManager", Types.PinManagerTypes);
        Assert.Contains("LidarManager", Types.PinManagerTypes);

        var pca = Schema(ChannelTypeSchema.PinManager, "Pca9685PwmExtension");
        Assert.Equal(["boardAddress", "i2cBus"], pca.Options.Select(o => o.Name));
        var bus = pca.Options.Single(o => o.Name == "i2cBus");
        Assert.Equal("integer", bus.Type);
        Assert.Equal("1", bus.DefaultJson);
        Assert.Equal("I2C bus number (/dev/i2c-N).", bus.Description);

        var lidar = Schema(ChannelTypeSchema.PinManager, "LidarManager");
        var port = lidar.Options.Single(o => o.Name == "port");
        Assert.Equal(("string", "\"/dev/lidar\""), (port.Type, port.DefaultJson));
        Assert.StartsWith("Serial device.", port.Description);
    }

    [Fact]
    public void ControlsLeaveOutTheChannelPlumbing()
    {
        var blinker = Schema(ChannelTypeSchema.Control, "PwmBlinker");
        // PwmBlinker is a PwmLight and inherits its fade options.
        Assert.Equal(["blinkCycleMs", "inertiaDelayMs", "inertiaStep"], blinker.Options.Select(o => o.Name));
        Assert.Equal("500", blinker.Options[0].DefaultJson);
        Assert.Equal(["command"], Schema(ChannelTypeSchema.Control, "CustomBash").Options.Select(o => o.Name));
    }

    [Fact]
    public void TelemetryReadersCarryArraysReferencesAndTheGroupKey()
    {
        var grid = Schema(ChannelTypeSchema.Telemetry, "SignalRC.Onboard.Telemetry.LidarGridTelemetryReader");
        var names = grid.Options.Select(o => o.Name).ToArray();
        Assert.Contains("groupKey", names);
        Assert.DoesNotContain("readIntervalTicks", names);
        var zones = grid.Options.Single(o => o.Name == "zoneLimitsMm");
        Assert.Equal(("array", "integer", "[500,1000,2000,3000,5000]"), (zones.Type, zones.ItemType, zones.DefaultJson));
        Assert.Equal(ChannelTypeSchema.PinManager, grid.Options.Single(o => o.Name == "pinManager").Reference);
        Assert.Equal("boolean", grid.Options.Single(o => o.Name == "scannerClockwise").Type);
    }

    [Fact]
    public void VideoWebcamsDescribeTheirFfmpegOptions()
    {
        var v4l2 = Schema(ChannelTypeSchema.Video, "v4l2");
        Assert.Equal(["ffmpegLogLevel", "inputFormat", "hwEncoder"], v4l2.Options.Select(o => o.Name));
        Assert.Contains("mjpeg", v4l2.Options.Single(o => o.Name == "inputFormat").Values!);
        var logLevel = v4l2.Options.Single(o => o.Name == "ffmpegLogLevel");
        Assert.Equal("\"warning\"", logLevel.DefaultJson);
        Assert.Contains("debug", logLevel.Values!);
    }

    [Fact]
    public void SchemasSurviveMessagePack()
    {
        var protocol = new MessagePackHubProtocol();
        var bytes = protocol.GetMessageBytes(new InvocationMessage("RegisterAvailableChannelTypes", [1, Types]));
        var buffer = new ReadOnlySequence<byte>(bytes);
        Assert.True(protocol.TryParseMessage(ref buffer, new Binder([typeof(int), typeof(AvailableChannelTypes)]), out var message));
        var received = (AvailableChannelTypes)((InvocationMessage)message!).Arguments[1]!;
        Assert.Equal(Types.PinManagerTypes, received.PinManagerTypes);
        Assert.Equal(
            System.Text.Json.JsonSerializer.Serialize(Types.OptionSchemas),
            System.Text.Json.JsonSerializer.Serialize(received.OptionSchemas));
    }

    [Fact]
    public void ControlOptionsBindToPropertiesButNotToThePlumbing()
    {
        var blinker = new PwmBlinker(NullLogger<PwmBlinker>.Instance) { Name = "left", Address = 3 };
        var options = new Dictionary<string, object> { ["blinkCycleMs"] = 250L, ["name"] = "hijack", ["address"] = 9L };
        ChannelOptionBinder.Apply(blinker, options, NullLogger.Instance, "channel left");
        Assert.Equal((250, "left", 3), (blinker.BlinkCycleMs, blinker.Name, blinker.Address));

        var bash = new CustomBash(NullLogger<CustomBash>.Instance);
        ChannelOptionBinder.Apply(bash, new Dictionary<string, object> { ["Command"] = "echo hi" }, NullLogger.Instance, "channel bash");
        Assert.Equal("echo hi", bash.Command);
    }

    private sealed class Binder(Type[] parameters) : IInvocationBinder
    {
        public IReadOnlyList<Type> GetParameterTypes(string methodName) => parameters;
        public Type GetReturnType(string invocationId) => typeof(object);
        public Type GetStreamItemType(string streamId) => typeof(object);
    }
}
