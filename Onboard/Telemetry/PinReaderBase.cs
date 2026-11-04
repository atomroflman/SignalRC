using Microsoft.Extensions.Logging;
using SignalRC.Onboard.Hardware;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Onboard.Telemetry;

/// <summary>
/// Common part of the pin readers: resolves the module of the channel's pinManager/address
/// lazily (the factory hands out the instance the controls use) and turns failures into
/// Error samples instead of exceptions.
/// </summary>
public abstract class PinReaderBase<TModule> : TelemetryReaderBase, IPinAddressedReader where TModule : class, IModule
{
    private readonly IModuleManagerFactory _factory;
    private TModule? _module;
    private string? _lastError;

    protected string PinManagerName { get; private set; } = "default";
    protected int? PinAddress { get; private set; }

    protected PinReaderBase(ILogger logger, IModuleManagerFactory factory) : base(logger)
    {
        _factory = factory;
    }

    void IPinAddressedReader.Bind(string pinManager, int? address)
    {
        PinManagerName = string.IsNullOrWhiteSpace(pinManager) ? "default" : pinManager;
        PinAddress = address;
        _module = null;
    }

    public override async Task<string> ReadTelemetry()
    {
        var samples = await ReadAllSamplesAsync("value");
        return samples?.Values.FirstOrDefault().Value ?? string.Empty;
    }

    public override async Task<IReadOnlyDictionary<string, string>?> ReadAllTelemetryAsync(string channelKey)
    {
        var samples = await ReadAllSamplesAsync(channelKey);
        return samples?.ToDictionary(s => s.Key, s => s.Value.Value);
    }

    public override async Task<IReadOnlyDictionary<string, TelemetrySample>?> ReadAllSamplesAsync(string channelKey)
    {
        try
        {
            if (PinAddress == null) throw new InvalidOperationException("The channel has no address (pin).");
            _module ??= _factory.Create(PinManagerName).GetModule<TModule>(PinAddress.Value);
            var sample = await ReadSampleAsync(_module);
            if (_lastError != null)
            {
                Logger.LogInformation("{Manager}#{Address} readable again.", PinManagerName, PinAddress);
                _lastError = null;
            }
            return new Dictionary<string, TelemetrySample> { [channelKey] = sample };
        }
        catch (Exception ex)
        {
            // Log once per distinct problem; the sample carries it every tick.
            if (ex.Message != _lastError)
            {
                Logger.LogWarning(ex, "Reading {Manager}#{Address} failed.", PinManagerName, PinAddress);
                _lastError = ex.Message;
            }
            _module = null;
            return new Dictionary<string, TelemetrySample> { [channelKey] = new(string.Empty, TelemetrySampleState.Error, 0) };
        }
    }

    protected abstract Task<TelemetrySample> ReadSampleAsync(TModule module);
}
