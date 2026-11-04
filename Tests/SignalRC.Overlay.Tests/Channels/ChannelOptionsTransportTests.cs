using System.Buffers;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Protocol;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Telemetry;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Overlay.Tests.Lidar;
using SignalRC.Server.Controllers;
using SignalRC.Server.Data;
using SignalRC.Server.Overlay.Lidar;
using SignalRC.Shared;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Channels;

/// <summary>
/// Channel options over the SignalR MessagePack protocol (server → onboard) and into the
/// onboard option binding. A JsonElement option arrives as an empty map; the server must send
/// plain values.
/// </summary>
public class ChannelOptionsTransportTests
{
    private const string LidarGridJson =
        """{"groupKey":"lidarGrid","pinManager":"lidar2","mountYawDeg":12.5,"zoneLimitsMm":[400,900,1800,2700,4500],"neighborMaxMm":60,"minGroupPoints":4,"scannerClockwise":false}""";
    private const string LidarJson = """{"groupKey":"lidar","pinManager":"lidar2","sectors":72,"frontHalfAngle":25}""";
    private const string PinManagerJson = """{"port":"/dev/ttyUSB3","baudRate":230400,"capturePath":null}""";
    private const string ControlJson = """{"Command":"echo hi"}""";

    [Fact]
    public void SoundPlayerAcceptsEveryOptionOfItsEditor()
    {
        var options = ChannelOptions.FromJson(
            """{"file":"horn.mp3","mode":"hold","retrigger":"ignore","loop":true,"volumePercent":150,"startSeconds":0.5,"endSeconds":2.5,"fadeInMs":10,"fadeOutMs":20,"duckOnTalk":true}""");
        var player = new SignalRC.Onboard.Control.ControlTypes.SoundPlayer(NullLogger<SignalRC.Onboard.Control.ControlTypes.SoundPlayer>.Instance, null!, null!);

        var problems = ChannelOptionBinder.Apply(player, options, NullLogger.Instance, "channel horn");

        Assert.Empty(problems);
        Assert.Equal("horn.mp3", player.File);
        Assert.Equal("hold", player.Mode);
        Assert.Equal(150, player.VolumePercent);
        Assert.Equal(20, player.FadeOutMs);
        Assert.True(player.DuckOnTalk);
    }

    [Fact]
    public void PlainOptionsSurviveMessagePackAsPlainValues()
    {
        var map = Received(ServerMap());

        var grid = map.TelemetryChannels["lidarGrid"].Options;
        Assert.Equal("lidarGrid", grid["groupKey"]);
        Assert.Equal("lidar2", grid["pinManager"]);
        Assert.Equal(12.5, Assert.IsType<double>(grid["mountYawDeg"]));
        Assert.Equal(60L, Convert.ToInt64(grid["neighborMaxMm"]));
        Assert.False(Assert.IsType<bool>(grid["scannerClockwise"]));
        Assert.Equal(new long[] { 400, 900, 1800, 2700, 4500 }, ((IEnumerable<object>)grid["zoneLimitsMm"]).Select(Convert.ToInt64));
        Assert.Equal("echo hi", map.ControlChannels["bash"].Options["Command"]);
        Assert.Null(map.PinManagers["lidar2"].Options["capturePath"]);
    }

    [Fact]
    public void ServerOptionsKeepTheirJsonForm()
    {
        // Browser and channel map hash serialize options with System.Text.Json; plain values give the same JSON.
        foreach (var json in new[] { LidarGridJson, LidarJson, PinManagerJson, ControlJson, """{"nested":{"a":[1,"x",true,null]},"big":12345678901}""" })
        {
            Assert.Equal(JsonSerializer.Serialize(JsonSerializer.Deserialize<Dictionary<string, object>>(json)), JsonSerializer.Serialize(ChannelOptions.FromJson(json)));
        }
        Assert.Empty(ChannelOptions.FromJson("not json"));
        Assert.Empty(ChannelOptions.FromJson("[1]"));
    }

    [Fact]
    public void OnboardBindsReceivedOptionsAndKeepsGroupsApart()
    {
        var logs = new CapturingLoggerProvider();
        var map = Received(ServerMap());
        var service = Telemetry(map, logs);

        service.EnsureReaders();

        Assert.Equal(["lidar", "lidarGrid"], service.SourceReaders.Keys.Order());
        var grid = Assert.IsType<LidarGridTelemetryReader>(service.SourceReaders["lidarGrid"]);
        Assert.Equal("lidar2", grid.PinManager);
        Assert.Equal(12.5, grid.MountYawDeg);
        Assert.Equal([400, 900, 1800, 2700, 4500], grid.ZoneLimitsMm);
        Assert.Equal(60, grid.NeighborMaxMm);
        Assert.Equal(4, grid.MinGroupPoints);
        Assert.False(grid.ScannerClockwise);
        var lidar = Assert.IsType<LidarTelemetryReader>(service.SourceReaders["lidar"]);
        Assert.Equal("lidar2", lidar.PinManager);
        Assert.Equal(72, lidar.Sectors);
        Assert.Equal(25, lidar.FrontHalfAngle);
        Assert.DoesNotContain(logs.Entries, e => e.Level >= LogLevel.Warning);
    }

    [Fact]
    public void ReceivedOptionsAlsoBindAfterNormalizingAndStoring()
    {
        // ControlService normalizes on receipt; the local store writes JSON and reads JsonElement back.
        var map = Received(ServerMap());
        ChannelOptions.Normalize(map);
        var stored = JsonSerializer.Deserialize<Dictionary<string, object>>(JsonSerializer.Serialize(map.TelemetryChannels["lidarGrid"].Options))!;
        Assert.Equal(JsonSerializer.Serialize(ChannelOptions.FromJson(LidarGridJson)), JsonSerializer.Serialize(stored));

        var reader = new LidarGridTelemetryReader(NullLogger<LidarGridTelemetryReader>.Instance, new FakeModuleFactory(new FakeLidarSource()));
        var logs = new CapturingLoggerProvider();
        ChannelOptionBinder.Apply(reader, stored, logs.CreateLogger("t"), "channel lidarGrid");
        Assert.Equal([400, 900, 1800, 2700, 4500], reader.ZoneLimitsMm);
        Assert.Equal(12.5, reader.MountYawDeg);
        Assert.Empty(logs.Entries);
    }

    [Fact]
    public void PinManagerAndControlOptionsBind()
    {
        var map = Received(ServerMap());
        var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        var factory = new ModuleManagerFactory(services.GetRequiredService<ILoggerFactory>(), services, map);
        var manager = Assert.IsType<LidarManager>(factory.Create("lidar2"));
        Assert.Equal("/dev/ttyUSB3", manager.Port);
        Assert.Equal(230400, manager.BaudRate);
        Assert.Equal(string.Empty, manager.CapturePath);

        Assert.Equal("echo hi", ChannelOptionBinder.Convert(map.ControlChannels["bash"].Options["Command"], typeof(string)));
    }

    [Fact]
    public void OldServerMapFormLogsClearErrorsAndSeparatesGroups()
    {
        // Servers before the fix sent JsonElement values: each arrives as an empty map.
        var map = Received(ServerMap(json => JsonSerializer.Deserialize<Dictionary<string, object>>(json)!));
        Assert.IsType<Dictionary<object, object>>(map.TelemetryChannels["lidarGrid"].Options["groupKey"]);

        var logs = new CapturingLoggerProvider();
        var service = Telemetry(map, logs);
        service.EnsureReaders();

        // No shared reader under a garbage group key: each channel keeps its own.
        Assert.Equal(["lidar", "lidarGrid"], service.SourceReaders.Keys.Order());
        var grid = Assert.IsType<LidarGridTelemetryReader>(service.SourceReaders["lidarGrid"]);
        Assert.Equal("lidar", grid.PinManager);
        Assert.Equal(LidarGridOptions.Default.ZoneLimitsMm, grid.ZoneLimitsMm);
        Assert.IsType<LidarTelemetryReader>(service.SourceReaders["lidar"]);

        Assert.Equal(2, logs.Entries.Count(e => e.Level == LogLevel.Warning && e.Message.Contains("groupKey") && e.Message.Contains("update the server")));
        var errors = logs.Entries.Where(e => e.Level == LogLevel.Error).ToList();
        Assert.Equal(6 + 3, errors.Count);
        Assert.All(errors, e => Assert.Contains("empty map", e.Message));
        Assert.All(errors, e => Assert.Null(e.Exception));
        Assert.DoesNotContain(logs.Entries, e => e.Message.Contains("not found or not writable"));

        // Running every tick does not repeat the group key warning.
        service.EnsureReaders();
        Assert.Equal(2, logs.Entries.Count(e => e.Message.Contains("groupKey")));
    }

    [Theory]
    [InlineData(5L, typeof(int), 5)]
    [InlineData((byte)7, typeof(double), 7.0)]
    [InlineData(2.0, typeof(int), 2)]
    [InlineData("1.5", typeof(double), 1.5)]
    [InlineData("42", typeof(int), 42)]
    [InlineData("true", typeof(bool), true)]
    [InlineData(3L, typeof(string), "3")]
    [InlineData(1.25, typeof(float), 1.25f)]
    [InlineData((ushort)9, typeof(long?), 9L)]
    public void ConvertsPrimitives(object value, Type target, object expected)
    {
        Assert.Equal(expected, ChannelOptionBinder.Convert(value, target));
    }

    [Fact]
    public void ConvertsCollectionsEnumsAndJsonElements()
    {
        Assert.Equal(new[] { 1, 2, 3 }, (int[])ChannelOptionBinder.Convert(new object[] { (byte)1, 2L, 3.0 }, typeof(int[]))!);
        Assert.Equal(new[] { 500, 1000 }, (int[])ChannelOptionBinder.Convert("500, 1000", typeof(int[]))!);
        Assert.Equal(new List<double> { 1, 2.5 }, ChannelOptionBinder.Convert(new List<object?> { 1L, 2.5 }, typeof(List<double>)));
        Assert.Equal(new[] { 4, 5 }, (int[])ChannelOptionBinder.Convert(JsonDocument.Parse("[4,5]").RootElement, typeof(int[]))!);
        Assert.Equal(7.5, ChannelOptionBinder.Convert(JsonDocument.Parse("7.5").RootElement, typeof(double)));
        Assert.Equal(DayOfWeek.Friday, ChannelOptionBinder.Convert("friday", typeof(DayOfWeek)));
        Assert.Equal(DayOfWeek.Monday, ChannelOptionBinder.Convert(1L, typeof(DayOfWeek)));
        Assert.Null(ChannelOptionBinder.Convert(JsonDocument.Parse("null").RootElement, typeof(int)));
        var dict = (Dictionary<string, int>)ChannelOptionBinder.Convert(new Dictionary<object, object> { ["a"] = (byte)1 }, typeof(Dictionary<string, int>))!;
        Assert.Equal(1, dict["a"]);

        var lost = Assert.Throws<ChannelOptionException>(() => ChannelOptionBinder.Convert(new Dictionary<object, object>(), typeof(int)));
        Assert.Contains("update the server", lost.Message);
        Assert.Throws<ChannelOptionException>(() => ChannelOptionBinder.Convert(JsonDocument.Parse("{}").RootElement, typeof(int[])));
    }

    [Fact]
    public void GroupKeyAcceptsStringsAndPrimitivesOnly()
    {
        static string Key(object? v, out string? warning) =>
            ChannelOptionBinder.ResolveGroupKey("ch", new Dictionary<string, object> { ["groupKey"] = v! }, out warning);

        Assert.Equal("battery", Key("battery", out var w)); Assert.Null(w);
        Assert.Equal("battery", Key(JsonDocument.Parse("\"battery\"").RootElement, out w)); Assert.Null(w);
        Assert.Equal("3", Key(3L, out w)); Assert.Null(w);
        Assert.Equal("ch", Key(null, out w)); Assert.Null(w);
        Assert.Equal("ch", Key(" ", out w)); Assert.Null(w);
        Assert.Equal("ch", Key(new Dictionary<object, object>(), out w)); Assert.Contains("update the server", w);
        Assert.Equal("ch", Key(new object[] { "a" }, out w)); Assert.NotNull(w);
        Assert.Equal("ch", ChannelOptionBinder.ResolveGroupKey("ch", new Dictionary<string, object>(), out w)); Assert.Null(w);
    }

    // --- helpers ---

    /// <summary>The map as the server builds it from the database (ChannelMapMapper / ToMapItem).</summary>
    private static ChannelMap ServerMap(Func<string, Dictionary<string, object>>? options = null)
    {
        options ??= ChannelOptions.FromJson;
        var grid = LidarGridSourceService.ToMapItem(new CarTelemetry
        {
            Id = 11, ChannelName = "lidarGrid", TelemetryType = LidarGridSourceService.ReaderType,
            DataType = TelemetryDataType.LidarGrid, ReadIntervalTicks = 2, OptionsJson = LidarGridJson,
        });
        var lidar = new TelemetryChannelMapItem
        {
            ServerId = 12, TelemetryType = typeof(LidarTelemetryReader).FullName!, ReadIntervalTicks = 5,
            Options = ChannelOptions.FromJson(LidarJson),
        };
        var bash = ChannelsController.ToMapItem(new CarChannel { Id = 3, ChannelName = "bash", ControlType = "CustomBash", OptionsJson = ControlJson });
        if (options != ChannelOptions.FromJson)
        {
            grid.Options = options(LidarGridJson);
            lidar.Options = options(LidarJson);
            bash.Options = options(ControlJson);
        }
        return new ChannelMap
        {
            PinManagers = { ["lidar2"] = new PinManagerMapItem { Type = "LidarManager", Options = options(PinManagerJson) } },
            ControlChannels = { ["bash"] = bash },
            TelemetryChannels = { ["lidarGrid"] = grid, ["lidar"] = lidar },
        };
    }

    /// <summary>Pushes the map through the onboard's hub protocol twice: ApplyChannelMap and the OpenCarConnection result.</summary>
    private static ChannelMap Received(ChannelMap map)
    {
        var protocol = new MessagePackHubProtocol();

        var bytes = protocol.GetMessageBytes(new InvocationMessage("ApplyChannelMap", [map, "hash"]));
        var buffer = new ReadOnlySequence<byte>(bytes);
        Assert.True(protocol.TryParseMessage(ref buffer, new Binder([typeof(ChannelMap), typeof(string)], typeof(object)), out var message));
        var pushed = (ChannelMap)((InvocationMessage)message!).Arguments[0]!;

        bytes = protocol.GetMessageBytes(CompletionMessage.WithResult("1", new CarConfiguration { ChannelMap = map }));
        buffer = new ReadOnlySequence<byte>(bytes);
        Assert.True(protocol.TryParseMessage(ref buffer, new Binder([], typeof(CarConfiguration)), out message));
        var returned = ((CarConfiguration)((CompletionMessage)message!).Result!).ChannelMap!;
        Assert.Equal(JsonSerializer.Serialize(pushed), JsonSerializer.Serialize(returned));
        return pushed;
    }

    private static TelemetryService Telemetry(ChannelMap map, CapturingLoggerProvider logs)
    {
        var services = new ServiceCollection()
            .AddLogging(b => b.ClearProviders().AddProvider(logs))
            .AddSingleton<IModuleManagerFactory>(new FakeModuleFactory(new FakeLidarSource()))
            .AddTransient<LidarGridTelemetryReader>()
            .AddTransient<LidarTelemetryReader>()
            .BuildServiceProvider();
        return new TelemetryService(map, null!, new ConfigurationBuilder().Build(),
            services.GetRequiredService<ILogger<TelemetryService>>(), services, new ServerCarConfigurationService());
    }

    private sealed class Binder(Type[] parameters, Type result) : IInvocationBinder
    {
        public IReadOnlyList<Type> GetParameterTypes(string methodName) => parameters;
        public Type GetReturnType(string invocationId) => result;
        public Type GetStreamItemType(string streamId) => typeof(object);
    }

    private sealed record LogEntry(LogLevel Level, string Message, Exception? Exception);

    private sealed class CapturingLoggerProvider : ILoggerProvider, ILogger
    {
        public readonly List<LogEntry> Entries = [];
        public ILogger CreateLogger(string categoryName) => this;
        public void Dispose() { }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (Entries) Entries.Add(new LogEntry(logLevel, formatter(state, exception), exception));
        }
    }
}
