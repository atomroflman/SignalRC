using Microsoft.Extensions.DependencyInjection;

namespace SignalRC.Onboard;

public static class IServiceCollectionExtensions
{
    public static IServiceCollection AddAllTransient(this IServiceCollection serviceCollection, Type baseServiceType)
    {
        var assembly = baseServiceType.Assembly;
        var types = assembly.GetTypes()
            .Where(t => t.IsClass && !t.IsAbstract && baseServiceType.IsAssignableFrom(t));

        foreach (var type in types)
        {
            serviceCollection.AddTransient(baseServiceType, type);
            serviceCollection.AddTransient(type);
        }

        return serviceCollection;
    }
}