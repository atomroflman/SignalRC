public interface IModule {}

/// <summary>A digital pin: written by controls, read by telemetry.</summary>
public interface IGpioModule : IModule
{
    /// <summary>
    /// Sets the logical pin value (after <c>activeLow</c> inversion).
    /// </summary>
    /// <exception cref="InvalidOperationException">The pin is configured as input.</exception>
    Task SetValue(bool value);

    /// <summary>
    /// Gets the current logical value of the pin.
    /// </summary>
    Task<bool> GetValue();

    /// <summary>
    /// Reads the pin for telemetry: the logical value plus what happened since
    /// the previous call (edges a polling reader would otherwise miss).
    /// </summary>
    Task<GpioReading> ReadAsync() => GetValue().ContinueWith(t => new GpioReading(t.Result, t.Result, 0, false, false));
}

/// <param name="Value">Logical value now (debounced, activeLow applied).</param>
/// <param name="Latched">True if the pin was active at any time since the previous read; equals Value without edge events.</param>
/// <param name="Edges">Debounced edges counted since the pin was opened.</param>
/// <param name="IsInput">The pin is configured as input.</param>
/// <param name="Measured">The value was read from the hardware, not taken from a cache.</param>
public readonly record struct GpioReading(bool Value, bool Latched, long Edges, bool IsInput, bool Measured);
