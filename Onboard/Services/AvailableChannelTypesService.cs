using System.Reflection;
using LteCar.Onboard.Control.ControlTypes;
using LteCar.Onboard.Telemetry;
using LteCar.Shared.Channels;

namespace LteCar.Onboard.Services;

// ponytail: enumerates every ControlType the Onboard knows about (via the
// [ControlType("...")] attribute) and every concrete TelemetryReaderBase
// subclass. The Server caches this per carId so the channel-config UI
// can offer autocomplete that's never out of sync with the running build.
// Reflection cost is paid once at startup; the result is cached statically.
public class AvailableChannelTypesService
{
    private static readonly Lazy<AvailableChannelTypes> _cache = new(BuildTypes);

    public AvailableChannelTypes GetAvailableTypes() => _cache.Value;

    private static AvailableChannelTypes BuildTypes()
    {
        var asm = typeof(AvailableChannelTypesService).Assembly;
        var baseType = typeof(ControlTypeBase);
        var controlTypes = asm.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && baseType.IsAssignableFrom(t))
            .Select(t => t.GetCustomAttribute<ControlTypeAttribute>()?.TypeName)
            .Where(name => !string.IsNullOrEmpty(name))
            .Cast<string>()
            .Distinct()
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToArray();

        var telemetryBase = typeof(TelemetryReaderBase);
        var telemetryTypes = asm.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && telemetryBase.IsAssignableFrom(t))
            .Select(t => t.FullName ?? t.Name)
            .Distinct()
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToArray();

        return new AvailableChannelTypes
        {
            ControlTypes = controlTypes,
            TelemetryTypes = telemetryTypes,
        };
    }
}
