using System.Text.Json.Serialization;
using MessagePack;

namespace SignalRC.Shared.Channels;

// ponytail: vehicle-reported list of every ControlType string and every
// telemetry reader class name the Onboard knows about. Browser fetches
// this to populate the channel-config autocomplete, so the UI can only
// suggest types the running Onboard build actually supports.
[MessagePackObject]
public class AvailableChannelTypes
{
    [Key(0)][JsonPropertyName("controlTypes")] public string[] ControlTypes { get; set; } = Array.Empty<string>();
    [Key(1)][JsonPropertyName("telemetryTypes")] public string[] TelemetryTypes { get; set; } = Array.Empty<string>();
    // ALSA devices as listed by `arecord -L` / `aplay -L` at connect time.
    [Key(2)][JsonPropertyName("audioInputDevices")] public AudioDeviceInfo[] AudioInputDevices { get; set; } = Array.Empty<AudioDeviceInfo>();
    [Key(3)][JsonPropertyName("audioOutputDevices")] public AudioDeviceInfo[] AudioOutputDevices { get; set; } = Array.Empty<AudioDeviceInfo>();
    // Class names a pinManager "type" may name.
    [Key(4)][JsonPropertyName("pinManagerTypes")] public string[] PinManagerTypes { get; set; } = Array.Empty<string>();
    // The "options" each type understands, for the options editor of the channel config.
    [Key(5)][JsonPropertyName("optionSchemas")] public ChannelTypeSchema[] OptionSchemas { get; set; } = Array.Empty<ChannelTypeSchema>();
    // Board the onboard runs on, from /proc/device-tree/model (e.g. "Raspberry Pi 5 Model B Rev 1.0");
    // null on other hardware. The pin editor draws the matching board.
    [Key(6)][JsonPropertyName("boardModel")] public string? BoardModel { get; set; }
}

/// <summary>Options of one pin manager, control, telemetry or video type.</summary>
[MessagePackObject]
public class ChannelTypeSchema
{
    public const string PinManager = "pinManager";
    public const string Control = "control";
    public const string Telemetry = "telemetry";
    public const string Video = "video";

    [Key(0)][JsonPropertyName("kind")] public string Kind { get; set; } = string.Empty;
    /// <summary>The name as written in the config: class name, ControlType name or reader full name.</summary>
    [Key(1)][JsonPropertyName("typeName")] public string TypeName { get; set; } = string.Empty;
    [Key(2)][JsonPropertyName("description")] public string? Description { get; set; }
    [Key(3)][JsonPropertyName("options")] public OptionSchema[] Options { get; set; } = Array.Empty<OptionSchema>();
    /// <summary>Telemetry readers: suggested data type, unit and decimals per value, applied when a channel is created.</summary>
    [Key(4)][JsonPropertyName("values")] public TelemetryValueHint[] Values { get; set; } = Array.Empty<TelemetryValueHint>();
}

/// <summary>What a telemetry reader delivers for one value key.</summary>
[MessagePackObject]
public class TelemetryValueHint
{
    /// <summary>
    /// The value key, matched like the onboard does: the full channel name, else the
    /// part after the last dot. Empty for a reader with a single value (any channel name).
    /// </summary>
    [Key(0)][JsonPropertyName("key")] public string Key { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("dataType")] public TelemetryDataType DataType { get; set; }
    [Key(2)][JsonPropertyName("unit")] public string? Unit { get; set; }
    [Key(3)][JsonPropertyName("decimals")] public byte? Decimals { get; set; }
    /// <summary>Only when an option has this value, as "option=Value" (case-insensitive); null = the default.</summary>
    [Key(4)][JsonPropertyName("when")] public string? When { get; set; }
}

[MessagePackObject]
public class OptionSchema
{
    /// <summary>Option key, camelCase (matching is case-insensitive onboard).</summary>
    [Key(0)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    /// <summary>JSON type: string, integer, number, boolean, array or object.</summary>
    [Key(1)][JsonPropertyName("type")] public string Type { get; set; } = "string";
    /// <summary>Element type of arrays.</summary>
    [Key(2)][JsonPropertyName("itemType")] public string? ItemType { get; set; }
    /// <summary>Allowed values (enums, known formats).</summary>
    [Key(3)][JsonPropertyName("values")] public string[]? Values { get; set; }
    /// <summary>Default as JSON text; null when unknown.</summary>
    [Key(4)][JsonPropertyName("defaultJson")] public string? DefaultJson { get; set; }
    [Key(5)][JsonPropertyName("description")] public string? Description { get; set; }
    /// <summary>The value names another config entry, e.g. "pinManager".</summary>
    [Key(6)][JsonPropertyName("reference")] public string? Reference { get; set; }
}

[MessagePackObject]
public class AudioDeviceInfo
{
    [Key(0)][JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [Key(1)][JsonPropertyName("description")] public string? Description { get; set; }
}
