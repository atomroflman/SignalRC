using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Control;
using SignalRC.Onboard.Control.ControlTypes;
using SignalRC.Onboard.Telemetry;
using SignalRC.Shared.Channels;

namespace SignalRC.Onboard.Services;

/// <summary>
/// Describes the "options" of a type the way <see cref="ChannelOptionBinder"/> applies them:
/// every public writable property, with its JSON type, the default of a fresh instance and
/// the XML doc summary (SignalRC.Onboard.xml next to the assembly) as description.
/// </summary>
public static class OptionSchemaBuilder
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    /// <summary>Channel plumbing set by the services, not options.</summary>
    private static readonly Type[] InfrastructureBases = [typeof(ControlTypeBase), typeof(TelemetryReaderBase)];

    public static ChannelTypeSchema Build(string kind, string typeName, Type type, XmlDocs docs, IEnumerable<OptionSchema>? extra = null)
    {
        var instance = TryCreate(type);
        var options = OptionProperties(type)
            .Select(p => Describe(p, instance, docs))
            .Concat(extra ?? [])
            .OrderBy(o => o.Name, StringComparer.Ordinal)
            .ToArray();
        return new ChannelTypeSchema { Kind = kind, TypeName = typeName, Description = docs.Type(type), Options = options };
    }

    /// <summary>Properties an option can set.</summary>
    public static IEnumerable<PropertyInfo> OptionProperties(Type type) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Where(p => p.SetMethod is { IsPublic: true } && p.GetIndexParameters().Length == 0)
            .Where(p => !InfrastructureBases.Contains(p.DeclaringType))
            .Where(p => !p.PropertyType.IsInterface && !typeof(Delegate).IsAssignableFrom(p.PropertyType));

    private static OptionSchema Describe(PropertyInfo property, object? instance, XmlDocs docs)
    {
        var (type, values) = JsonType(property.PropertyType);
        var element = ChannelOptionBinder.ElementType(Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType);
        var schema = new OptionSchema
        {
            Name = JsonNamingPolicy.CamelCase.ConvertName(property.Name),
            Type = type,
            ItemType = element != null ? JsonType(element).Type : null,
            Values = values,
            Description = docs.Property(property),
            // By convention, a string option ending in PinManager names a pin manager.
            Reference = property.PropertyType == typeof(string) && property.Name.EndsWith("PinManager", StringComparison.Ordinal) ? ChannelTypeSchema.PinManager : null,
        };
        if (instance != null)
        {
            try
            {
                var value = property.GetValue(instance);
                if (value != null) schema.DefaultJson = JsonSerializer.Serialize(value, value.GetType(), JsonOptions);
            }
            catch
            {
                // A getter that needs a started instance has no default to show.
            }
        }
        return schema;
    }

    public static (string Type, string[]? Values) JsonType(Type type)
    {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (type == typeof(string) || type == typeof(Guid)) return ("string", null);
        if (type == typeof(bool)) return ("boolean", null);
        if (type.IsEnum) return ("string", Enum.GetNames(type));
        switch (Type.GetTypeCode(type))
        {
            case TypeCode.Byte: case TypeCode.SByte: case TypeCode.Int16: case TypeCode.UInt16:
            case TypeCode.Int32: case TypeCode.UInt32: case TypeCode.Int64: case TypeCode.UInt64:
                return ("integer", null);
            case TypeCode.Single: case TypeCode.Double: case TypeCode.Decimal:
                return ("number", null);
        }
        return ChannelOptionBinder.ElementType(type) != null ? ("array", null) : ("object", null);
    }

    /// <summary>
    /// A fresh instance for reading property defaults: loggers are null loggers, every other
    /// constructor argument is null. Types whose constructor needs more simply have no defaults.
    /// </summary>
    private static object? TryCreate(Type type)
    {
        foreach (var ctor in type.GetConstructors().OrderBy(c => c.GetParameters().Length))
        {
            try
            {
                var instance = ctor.Invoke(ctor.GetParameters().Select(p => Fake(p.ParameterType)).ToArray());
                GC.SuppressFinalize(instance);
                return instance;
            }
            catch
            {
                // try the next constructor
            }
        }
        return null;
    }

    private static object? Fake(Type type)
    {
        if (type == typeof(IServiceProvider)) return NullServices.Instance;
        if (type == typeof(ILogger)) return NullLogger.Instance;
        if (type == typeof(ILoggerFactory)) return NullLoggerFactory.Instance;
        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(ILogger<>))
            return Activator.CreateInstance(typeof(NullLogger<>).MakeGenericType(type.GetGenericArguments()));
        return type.IsValueType ? Activator.CreateInstance(type) : null;
    }

    private sealed class NullServices : IServiceProvider
    {
        public static readonly NullServices Instance = new();
        public object? GetService(Type serviceType) => serviceType == typeof(IServiceProvider) ? null : Fake(serviceType);
    }
}

/// <summary>Summaries from the XML documentation file of an assembly; empty when it is missing.</summary>
public sealed class XmlDocs
{
    private readonly Dictionary<string, string> _summaries = new(StringComparer.Ordinal);

    public static XmlDocs Load(Assembly assembly)
    {
        var docs = new XmlDocs();
        try
        {
            var path = Path.ChangeExtension(assembly.Location, ".xml");
            if (!File.Exists(path)) return docs;
            foreach (var member in XDocument.Load(path).Descendants("member"))
            {
                var name = member.Attribute("name")?.Value;
                var summary = member.Element("summary");
                if (name != null && summary != null) docs._summaries[name] = Text(summary);
            }
        }
        catch
        {
            // Descriptions are a convenience; a broken file just leaves them out.
        }
        return docs;
    }

    public string? Type(Type type) => _summaries.GetValueOrDefault("T:" + Id(type));

    public string? Property(PropertyInfo property) =>
        _summaries.GetValueOrDefault($"P:{Id(property.DeclaringType!)}.{property.Name}");

    private static string Id(Type type) => (type.FullName ?? type.Name).Replace('+', '.');

    private static readonly Regex Space = new(@"\s+");

    /// <summary>Summary text with see/paramref references reduced to their last name segment.</summary>
    private static string Text(XElement summary)
    {
        foreach (var reference in summary.Descendants().Where(e => e.Name == "see" || e.Name == "paramref" || e.Name == "typeparamref").ToList())
        {
            var target = reference.Attribute("cref")?.Value ?? reference.Attribute("name")?.Value ?? reference.Attribute("langword")?.Value ?? string.Empty;
            var shortName = target.Split(':').Last().Split('.').Last();
            reference.ReplaceWith(string.IsNullOrEmpty(reference.Value) ? shortName : reference.Value);
        }
        return Space.Replace(summary.Value, " ").Trim();
    }
}
