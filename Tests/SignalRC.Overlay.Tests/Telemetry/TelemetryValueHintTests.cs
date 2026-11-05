using System.Globalization;
using System.Reflection;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Hardware;
using SignalRC.Onboard.Hardware.Can;
using SignalRC.Onboard.Hardware.Lidar;
using SignalRC.Onboard.Services;
using SignalRC.Onboard.Telemetry;
using SignalRC.Overlay.Tests.Lidar;
using SignalRC.Shared.Channels;

namespace SignalRC.Overlay.Tests.Telemetry;

// The suggested channel types (TelemetryValueAttribute) must cover every key a
// reader produces, and each value must fit its suggested type.
public class TelemetryValueHintTests
{
    private static Dictionary<string, TelemetryValueAttribute> Hints<T>() =>
        typeof(T).GetCustomAttributes<TelemetryValueAttribute>(false).Where(a => a.When == null).ToDictionary(a => a.Key);

    private static void AssertCovered(Dictionary<string, TelemetryValueAttribute> hints, IReadOnlyDictionary<string, string> values)
    {
        Assert.Empty(values.Keys.Except(hints.Keys).Order());
        Assert.Empty(hints.Keys.Except(values.Keys).Order());
        foreach (var (key, value) in values)
        {
            if (value.Length == 0) continue;
            var type = hints[key].DataType;
            if (type == TelemetryDataType.Boolean) Assert.True(value is "0" or "1", $"{key}={value}");
            if (type == TelemetryDataType.Integer) Assert.True(long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out _), $"{key}={value}");
            if (type == TelemetryDataType.Number) Assert.True(double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out _), $"{key}={value}");
        }
    }

    [Fact]
    public void TrackDriveKeysAllHaveFittingHints()
    {
        var node = new TrackNodeState { Seen = true, AgeSeconds = 0.01, TemperatureCelsius = 31, LimitsSeen = true, SpeedLimitRadPerSecond = 12.5, UsableVolts = 24.1 };
        var snapshot = new TrackDriveSnapshot
        {
            Left = node,
            Right = node,
            ControlAgeSeconds = 0.05,
            RequestedSpeedLimit = 10,
            RequestedCurrentLimit = 5,
            Odometry = new TrackOdometry { Calibrated = true },
        };
        AssertCovered(Hints<CanTrackDriveTelemetryReader>(), CanTrackDriveTelemetryReader.BuildValues(snapshot));
    }

    private sealed class NoFactory : IModuleManagerFactory
    {
        public IModuleManager Create(string name) => throw new NotSupportedException();
    }

    [Fact]
    public void LidarKeysAllHaveFittingHints()
    {
        var reader = new LidarTelemetryReader(NullLogger<LidarTelemetryReader>.Instance, new NoFactory());
        var health = new LidarHealth { PortOpen = true, Spinning = true, ScanAgeSeconds = 0.05, Rpm = 360, Pico = new LidarStatus() };
        var scan = LidarTestData.Scan(LidarTestData.Run(0, 20, 800), 1);
        AssertCovered(Hints<LidarTelemetryReader>(), reader.BuildValues(health, scan));
    }

    [Fact]
    public async Task UptimeIsWholeSeconds()
    {
        var reader = new ApplicationLifetimeReader(NullLogger<ApplicationLifetimeReader>.Instance);
        Assert.True(long.TryParse(await reader.ReadTelemetry(), NumberStyles.None, CultureInfo.InvariantCulture, out _));
    }

    [Fact]
    public void SchemaReportsHintsWithConditions()
    {
        var docs = XmlDocs.Load(typeof(CpuTemperatureReader).Assembly);
        var cpu = OptionSchemaBuilder.Build(ChannelTypeSchema.Telemetry, "cpu", typeof(CpuTemperatureReader), docs);
        var hint = Assert.Single(cpu.Values);
        Assert.Equal(("", TelemetryDataType.Number, "°C", (byte?)1), (hint.Key, hint.DataType, hint.Unit, hint.Decimals));

        var gpio = OptionSchemaBuilder.Build(ChannelTypeSchema.Telemetry, "gpio", typeof(GpioPinReader), docs);
        Assert.Contains(gpio.Values, h => h.When == null && h.DataType == TelemetryDataType.Boolean);
        Assert.Contains(gpio.Values, h => h.When == "report=Edges" && h.DataType == TelemetryDataType.Integer);

        // A reader without fixed values suggests nothing.
        Assert.Empty(OptionSchemaBuilder.Build(ChannelTypeSchema.Telemetry, "store", typeof(StoreBackedTelemetryReader), docs).Values);
    }
}
