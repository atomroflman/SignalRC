using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Shared.HubClients;

namespace SignalRC.Server.Telemetry;

/// <summary>Group of old clients that still receive UpdateTelemetry(name, value).</summary>
public static class TelemetryGroups
{
    public static string Legacy(int carId) => $"telemetry-legacy:{carId}";
}

public sealed class HubTelemetryTransport(
    IHubContext<CarConnectionHub> hub,
    IHubContext<CarConnectionHub, IConnectionHubClient> typedHub) : ITelemetryTransport, IControlDisplayTransport
{
    public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) =>
        hub.Clients.Client(connectionId).SendAsync("Tlm", carId, seq, ageMs, changed, touched, touchedAged);

    public Task SendLegacyAsync(int carId, string channelName, string value) =>
        typedHub.Clients.Group(TelemetryGroups.Legacy(carId)).UpdateTelemetry(channelName, value);

    public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) =>
        typedHub.Clients.Client(onboardConnectionId).SetTelemetryDemand(channelIds);

    public Task SendAsync(string connectionId, int carId, string driverEpoch, long seq, bool paused, int ageMs,
        object[][] outputs, object[][] signals, int[] removedOutputs, string[] removedSignals) =>
        hub.Clients.Client(connectionId).SendAsync("Ctl", carId, driverEpoch, seq, paused, ageMs, outputs, signals, removedOutputs, removedSignals);

    public Task SendClearedAsync(string connectionId, int carId, string driverEpoch) =>
        hub.Clients.Client(connectionId).SendAsync("CtlCleared", carId, driverEpoch);

    public Task SendDemandAsync(string driverConnectionId, int carId, bool needed) =>
        hub.Clients.Client(driverConnectionId).SendAsync("CtlDemand", carId, needed);
}

public sealed class DbTelemetryChannelDirectory(IServiceScopeFactory scopes) : ITelemetryChannelDirectory
{
    public async Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        return await db.CarTelemetry.AsNoTracking().Where(t => t.CarId == carId).ToDictionaryAsync(t => t.Id, t => t.ChannelName);
    }
}

public static class TelemetryRegistration
{
    public static IServiceCollection AddTelemetryRelay(this IServiceCollection services)
    {
        services.AddSingleton<HubTelemetryTransport>();
        services.AddSingleton<ITelemetryTransport>(sp => sp.GetRequiredService<HubTelemetryTransport>());
        services.AddSingleton<IControlDisplayTransport>(sp => sp.GetRequiredService<HubTelemetryTransport>());
        services.AddSingleton<ITelemetryChannelDirectory, DbTelemetryChannelDirectory>();
        services.AddSingleton<History.TelemetryRecorder>();
        services.AddSingleton<ITelemetrySink>(sp => sp.GetRequiredService<History.TelemetryRecorder>());
        services.AddHostedService(sp => sp.GetRequiredService<History.TelemetryRecorder>());
        services.AddSingleton<TelemetryRelay>();
        services.AddSingleton<History.TelemetryChannelsChanged>();
        services.AddSingleton<ControlDisplayRelay>();
        services.AddSingleton<SignalRC.Server.Overlay.HudInputRateLimit>();
        services.TryAddSingleton(TimeProvider.System);
        return services;
    }
}
