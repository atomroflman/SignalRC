using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Control;

/// <summary>
/// Sets channel / pin manager options on reader and manager properties. Values come as
/// plain CLR values (MessagePack), JsonElement (local store, channelMap.json) or, from
/// servers before the plain-value fix, as empty maps that lost their content.
/// </summary>
public static class ChannelOptionBinder
{
    public const string GroupKeyOption = "groupKey";

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    /// <summary>Options consumed by the onboard services, not by the target type.</summary>
    private static readonly HashSet<string> ServiceOptions = new(StringComparer.OrdinalIgnoreCase) { GroupKeyOption };

    /// <summary>Applies every option to a writable property of the same name (case-insensitive).</summary>
    public static void Apply(object target, IReadOnlyDictionary<string, object> options, ILogger logger, string owner, bool warnUnknown = true)
    {
        var type = target.GetType();
        foreach (var option in options)
        {
            if (ServiceOptions.Contains(option.Key)) continue;
            var property = type.GetProperty(option.Key, BindingFlags.IgnoreCase | BindingFlags.Public | BindingFlags.Instance);
            // Name, Address, PinManager … of a control are set from the channel itself.
            if (property?.DeclaringType == typeof(ControlTypes.ControlTypeBase)) property = null;
            if (property == null || !property.CanWrite)
            {
                if (warnUnknown)
                    logger.LogWarning("Option {Option} not found or not writable on {Type} for {Owner}", option.Key, type.Name, owner);
                continue;
            }
            try
            {
                var value = Convert(option.Value, property.PropertyType);
                if (value == null) continue;
                property.SetValue(target, value);
            }
            catch (ChannelOptionException ex)
            {
                logger.LogError("Option {Option} for {Owner} not applied: {Reason}", option.Key, owner, ex.Message);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to set option {Option} for {Owner} with value {Value}", option.Key, owner, Describe(option.Value));
            }
        }
    }

    /// <summary>
    /// The group key of a telemetry channel; channels with the same key share one reader.
    /// Only strings and primitives count, anything else falls back to the channel name.
    /// </summary>
    public static string ResolveGroupKey(string channelName, IReadOnlyDictionary<string, object> options, out string? warning)
    {
        warning = null;
        if (!options.TryGetValue(GroupKeyOption, out var raw)) return channelName;
        var value = ChannelOptions.Normalize(raw);
        var key = value switch
        {
            null => null,
            string s => s,
            IDictionary or IEnumerable => null,
            IConvertible c => c.ToString(CultureInfo.InvariantCulture),
            _ => null,
        };
        if (value != null && key == null)
        {
            warning = $"Option groupKey of channel {channelName} is not a string ({Describe(raw)}); using the channel name as group."
                + (IsLostMap(value) ? " " + LostMapHint : string.Empty);
        }
        return string.IsNullOrWhiteSpace(key) ? channelName : key;
    }

    /// <summary>Converts an option value to the target type; null for a null value.</summary>
    public static object? Convert(object? raw, Type targetType)
    {
        var type = Nullable.GetUnderlyingType(targetType) ?? targetType;
        var value = ChannelOptions.Normalize(raw);
        if (value == null) return null;
        if (type == typeof(object) || type.IsInstanceOfType(value) && value is not IEnumerable || value is string && type == typeof(string))
            return value;

        if (value is IDictionary map && !IsComplex(type))
        {
            throw new ChannelOptionException(map.Count == 0
                ? $"value is an empty map instead of {type.Name}. {LostMapHint}"
                : $"value is a map, cannot convert to {type.Name}");
        }

        if (type.IsEnum)
        {
            return value is string name
                ? Enum.Parse(type, name, ignoreCase: true)
                : Enum.ToObject(type, System.Convert.ToInt64(value, CultureInfo.InvariantCulture));
        }
        if (type == typeof(Guid)) return Guid.Parse(System.Convert.ToString(value, CultureInfo.InvariantCulture)!);
        if (type == typeof(string)) return System.Convert.ToString(value, CultureInfo.InvariantCulture);
        if (type.IsPrimitive || type == typeof(decimal))
        {
            if (value is IEnumerable and not string) throw new ChannelOptionException($"value is a list, cannot convert to {type.Name}");
            return System.Convert.ChangeType(value, type, CultureInfo.InvariantCulture);
        }

        var elementType = ElementType(type);
        if (elementType != null)
        {
            var items = value switch
            {
                // "500,1000,2000" as the UI may store it (OverlaySourceCatalog.ZoneLimits).
                string s => s.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Cast<object?>().ToList(),
                IEnumerable e => e.Cast<object?>().ToList(),
                _ => [value],
            };
            var converted = items.Select(i => Convert(i, elementType)).ToList();
            if (type.IsArray)
            {
                var array = Array.CreateInstance(elementType, converted.Count);
                for (var i = 0; i < converted.Count; i++) array.SetValue(converted[i], i);
                return array;
            }
            var list = (IList)Activator.CreateInstance(typeof(List<>).MakeGenericType(elementType))!;
            foreach (var item in converted) list.Add(item);
            return list;
        }

        return JsonSerializer.SerializeToElement(value).Deserialize(type, JsonOptions);
    }

    private const string LostMapHint = "The server sent a JsonElement that MessagePack cannot carry; update the server.";

    private static bool IsLostMap(object? value) => value is IDictionary { Count: 0 };

    private static bool IsComplex(Type type) =>
        !type.IsPrimitive && !type.IsEnum && type != typeof(string) && type != typeof(decimal) && type != typeof(Guid) && ElementType(type) == null;

    /// <summary>Element type of arrays and List/IList/IEnumerable/IReadOnlyList&lt;T&gt;; null otherwise.</summary>
    internal static Type? ElementType(Type type)
    {
        if (type.IsArray) return type.GetElementType();
        if (!type.IsGenericType) return null;
        var def = type.GetGenericTypeDefinition();
        return def == typeof(List<>) || def == typeof(IList<>) || def == typeof(IEnumerable<>)
            || def == typeof(IReadOnlyList<>) || def == typeof(ICollection<>) || def == typeof(IReadOnlyCollection<>)
            ? type.GetGenericArguments()[0]
            : null;
    }

    private static string Describe(object? value) => value switch
    {
        null => "null",
        JsonElement e => e.GetRawText(),
        string s => s,
        IDictionary d => $"map with {d.Count} entries",
        IEnumerable e => $"[{string.Join(", ", e.Cast<object?>().Select(Describe))}]",
        _ => System.Convert.ToString(value, CultureInfo.InvariantCulture) ?? string.Empty,
    };
}

public sealed class ChannelOptionException(string message) : Exception(message);
