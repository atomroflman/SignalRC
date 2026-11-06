using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using SignalRC.Server.Controllers;
using SignalRC.Server.Data;
using SignalRC.Shared.Audio;
using SignalRC.Shared.Video;

namespace SignalRC.Server.Services;

/// <summary>
/// The whole configuration of a vehicle as one file (setup page "Konfiguration exportieren /
/// importieren"): pin managers, control, telemetry and video channels in the shapes the
/// channel editor saves (the PUT bodies of ChannelsController), plus the audio settings.
/// </summary>
public class VehicleConfigFile
{
    public const string FormatName = "signalrc-vehicle-config";
    public const int CurrentVersion = 1;

    [JsonPropertyName("format")] public string Format { get; set; } = FormatName;
    [JsonPropertyName("version")] public int Version { get; set; } = CurrentVersion;
    [JsonPropertyName("exportedAt")] public DateTime ExportedAt { get; set; }
    [JsonPropertyName("carId")] public int CarId { get; set; }
    [JsonPropertyName("carName")] public string? CarName { get; set; }
    [JsonPropertyName("pinManagers")] public List<PinManagerDto> PinManagers { get; set; } = new();
    [JsonPropertyName("controlChannels")] public List<ControlChannelDto> ControlChannels { get; set; } = new();
    [JsonPropertyName("telemetryChannels")] public List<TelemetryChannelDto> TelemetryChannels { get; set; } = new();
    [JsonPropertyName("videoStreams")] public List<VideoStreamDto> VideoStreams { get; set; } = new();
    [JsonPropertyName("audio")] public AudioSettings? Audio { get; set; }
}

/// <summary>
/// Entity ↔ editor DTO, shared by the channel editor (ChannelsController PUT) and the
/// configuration import, so both write a channel the same way.
/// </summary>
public static class VehicleConfigMapper
{
    public static Dictionary<string, object> DeserializeOptions(string? json)
    {
        if (string.IsNullOrEmpty(json)) return new();
        try { return JsonSerializer.Deserialize<Dictionary<string, object>>(json) ?? new(); }
        catch { return new(); }
    }

    public static string? SerializeOptions(Dictionary<string, object>? options)
    {
        if (options == null || options.Count == 0) return null;
        return JsonSerializer.Serialize(options);
    }

    // -- To the file --------------------------------------------------------------------

    public static PinManagerDto ToDto(CarPinManager p) => new() { Name = p.Name, Type = p.Type, Options = DeserializeOptions(p.OptionsJson) };

    public static ControlChannelDto ToDto(CarChannel c) => new()
    {
        ChannelName = c.ChannelName,
        DisplayName = c.DisplayName,
        IsEnabled = c.IsEnabled,
        RequiresAxis = c.RequiresAxis,
        MaxResendInterval = c.MaxResendInterval,
        ControlType = c.ControlType,
        PinManager = c.PinManager,
        Address = c.Address,
        Options = DeserializeOptions(c.OptionsJson),
        TestDisabled = c.TestDisabled,
    };

    public static TelemetryChannelDto ToDto(CarTelemetry t) => new()
    {
        ChannelName = t.ChannelName,
        ReadIntervalTicks = t.ReadIntervalTicks,
        TelemetryType = t.TelemetryType,
        DataType = t.DataType,
        Unit = t.Unit,
        Decimals = t.Decimals,
        PinManager = t.PinManager,
        Address = t.Address,
        Options = DeserializeOptions(t.OptionsJson),
    };

    public static VideoStreamDto ToDto(CarVideoStream s) => new()
    {
        StreamId = s.StreamId,
        Name = s.Name,
        Type = s.Type,
        Location = s.Location,
        Enabled = s.Enabled,
        Width = s.Width,
        Height = s.Height,
        Framerate = s.Framerate,
        BitrateKbps = s.Bitrate,
        Brightness = s.Brightness,
        Priority = s.Priority,
        Port = s.Port,
        JanusPort = s.JanusPort,
        Protocol = s.Protocol,
        ProcessArguments = s.ProcessArguments,
        StreamPurpose = s.StreamPurpose,
        Description = s.Description,
        CameraDevice = s.CameraDevice,
        RpiCamId = s.RpiCamId,
        Options = DeserializeOptions(s.OptionsJson),
    };

    // -- From an editor body or the file ------------------------------------------------

    public static void Apply(CarPinManager p, PinManagerDto body)
    {
        p.Type = body.Type ?? string.Empty;
        p.OptionsJson = SerializeOptions(body.Options);
        p.ModifiedAt = DateTime.UtcNow;
    }

    public static void Apply(CarChannel ch, ControlChannelDto body)
    {
        if (body.DisplayName != null) ch.DisplayName = body.DisplayName;
        ch.IsEnabled = body.IsEnabled;
        ch.RequiresAxis = body.RequiresAxis;
        ch.MaxResendInterval = body.MaxResendInterval;
        if (body.ControlType != null) ch.ControlType = body.ControlType;
        if (body.PinManager != null) ch.PinManager = body.PinManager;
        ch.Address = body.Address;
        ch.OptionsJson = SerializeOptions(body.Options);
        if (body.TestDisabled.HasValue) ch.TestDisabled = body.TestDisabled.Value;
        ch.ModifiedAt = DateTime.UtcNow;
    }

    public static void Apply(CarTelemetry t, TelemetryChannelDto body)
    {
        t.ReadIntervalTicks = body.ReadIntervalTicks;
        t.TelemetryType = body.TelemetryType ?? string.Empty;
        t.DataType = body.DataType;
        t.Unit = body.Unit;
        t.Decimals = body.Decimals;
        if (body.PinManager != null) t.PinManager = body.PinManager;
        t.Address = body.Address;
        t.OptionsJson = SerializeOptions(body.Options);
        t.ModifiedAt = DateTime.UtcNow;
    }

    /// <summary>A new stream row with the defaults the editor uses.</summary>
    public static CarVideoStream NewStream(int carId, string streamId, VideoStreamDto body) => new()
    {
        CarId = carId,
        StreamId = streamId,
        Name = body.Name ?? streamId,
        Type = body.Type ?? "unknown",
        StartTime = DateTime.UtcNow,
        Protocol = body.Protocol ?? StreamProtocol.TCP,
        Port = body.Port ?? 0,
        Enabled = body.Enabled,
    };

    public static void Apply(CarVideoStream s, VideoStreamDto body)
    {
        s.Name = body.Name ?? s.Name;
        s.Type = body.Type ?? s.Type;
        s.Location = body.Location;
        s.Enabled = body.Enabled;
        if (body.Width.HasValue) s.Width = body.Width.Value;
        if (body.Height.HasValue) s.Height = body.Height.Value;
        if (body.Framerate.HasValue) s.Framerate = body.Framerate.Value;
        if (body.BitrateKbps.HasValue) s.Bitrate = body.BitrateKbps.Value;
        if (body.Brightness.HasValue) s.Brightness = body.Brightness.Value;
        if (body.Priority.HasValue) s.Priority = body.Priority.Value;
        if (body.Port.HasValue) s.Port = body.Port.Value;
        if (body.JanusPort.HasValue) s.JanusPort = body.JanusPort;
        if (body.Protocol.HasValue) s.Protocol = body.Protocol.Value;
        s.CameraDevice = body.CameraDevice;
        s.RpiCamId = body.RpiCamId;
        s.OptionsJson = SerializeOptions(body.Options);
        s.ProcessArguments = body.ProcessArguments;
        s.StreamPurpose = body.StreamPurpose;
        s.Description = body.Description;
        s.LastStatusUpdate = DateTime.UtcNow;
        s.ModifiedAt = DateTime.UtcNow;
    }

    /// <summary>Whether two DTOs describe the same configuration (property order of options does not matter).</summary>
    public static bool Same<T>(T a, T b) =>
        JsonNode.DeepEquals(JsonSerializer.SerializeToNode(a), JsonSerializer.SerializeToNode(b));
}
