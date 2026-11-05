using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Declares what a reader delivers for one value key, so the channel setup can
/// suggest data type, unit and decimals (reported via <see cref="TelemetryValueHint"/>).
/// An empty key is the single value of a one-value reader.
/// </summary>
[AttributeUsage(AttributeTargets.Class, AllowMultiple = true, Inherited = false)]
public sealed class TelemetryValueAttribute(string key, TelemetryDataType dataType, string? unit = null) : Attribute
{
    public string Key { get; } = key;
    public TelemetryDataType DataType { get; } = dataType;
    public string? Unit { get; } = unit;
    /// <summary>Decimals to show; -1 = no suggestion.</summary>
    public int Decimals { get; set; } = -1;
    /// <summary>Only when an option has this value, e.g. "report=Edges".</summary>
    public string? When { get; set; }

    public TelemetryValueHint ToHint() => new()
    {
        Key = Key,
        DataType = DataType,
        Unit = Unit,
        Decimals = Decimals >= 0 ? (byte)Decimals : null,
        When = When,
    };
}
