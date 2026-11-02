using Microsoft.EntityFrameworkCore;
using SignalRC.Server.Data;

namespace SignalRC.Server.Overlay;

/// <summary>Daily asset cleanup; saving cleans the saved vehicle right away.</summary>
public sealed class OverlayAssetCleanupService(IServiceScopeFactory scopes, ILogger<OverlayAssetCleanupService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromDays(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
                var service = scope.ServiceProvider.GetRequiredService<OverlayService>();
                foreach (var carId in await db.OverlayAssets.Select(a => a.CarId).Distinct().ToListAsync(stoppingToken))
                {
                    await service.CollectGarbageAsync(carId);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "Overlay asset cleanup failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
