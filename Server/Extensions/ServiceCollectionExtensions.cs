using LteCar.Server.Configuration;
using LteCar.Server.Services;

namespace LteCar.Server.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApplicationConfiguration(this IServiceCollection services, IConfiguration configuration)
    {
        // Configure strongly-typed configuration
        services.Configure<ApplicationConfiguration>(configuration);
        services.Configure<JanusConfiguration>(
            configuration.GetSection(JanusConfiguration.SectionName));
        services.Configure<FileTransferConfiguration>(
            configuration.GetSection(FileTransferConfiguration.SectionName));
        services.Configure<WebRtcConfiguration>(
            configuration.GetSection(WebRtcConfiguration.SectionName));

        // Register configuration service
        services.AddSingleton<IConfigurationService, ConfigurationService>();

        return services;
    }

    public static void ValidateConfiguration(this IServiceProvider serviceProvider)
    {
        // This will trigger validation during startup
        serviceProvider.GetRequiredService<IConfigurationService>();
    }
}