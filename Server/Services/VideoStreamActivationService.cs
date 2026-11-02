using SignalRC.Server.Data;
using SignalRC.Server.Hubs;
using SignalRC.Shared.HubClients;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace SignalRC.Server.Services;

/// <summary>
/// An enabled stream runs, a disabled one doesn't; nobody starts streams by hand anymore. Whoever
/// changes a stream's enabled state, its port or audio (or a car reconnects) calls <see cref="ApplyAsync"/>,
/// which brings the Janus mountpoint and the onboard in line with what's stored.
/// </summary>
public class VideoStreamActivationService(
    IServiceScopeFactory scopeFactory,
    IHubContext<CarConnectionHub, IConnectionHubClient> hub,
    VideoStreamReceiverService streamService,
    ILogger<VideoStreamActivationService> logger)
{
    public async Task ApplyAsync(int streamId)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        var stream = await db.CarVideoStreams.AsNoTracking().FirstOrDefaultAsync(s => s.Id == streamId);
        if (stream == null)
        {
            logger.LogWarning("Video stream {StreamId} not found, nothing to apply", streamId);
            return;
        }

        if (stream.Enabled)
            await StartAsync(stream);
        else
            await StopAsync(stream.CarId, stream.StreamId, stream.Id);
    }

    public async Task ApplyCarAsync(int carId)
    {
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        var streamIds = await db.CarVideoStreams.Where(s => s.CarId == carId).Select(s => s.Id).ToListAsync();
        foreach (var streamId in streamIds)
        {
            try
            {
                await ApplyAsync(streamId);
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to apply video stream {StreamId} of car {CarId}", streamId, carId);
            }
        }
    }

    /// <summary>For a stream that is gone from the database already.</summary>
    public async Task StopAsync(int carId, string streamKey, int streamId)
    {
        logger.LogInformation("Stopping video stream {StreamId} ({StreamKey}) for car {CarId}", streamId, streamKey, carId);
        var car = hub.Clients.Group($"Car-{carId}");
        await car.StopVideoStream(streamKey);
        await car.StopAudioUplink(streamKey);
        await streamService.StopStream(streamId);
    }

    private async Task StartAsync(CarVideoStream stream)
    {
        logger.LogInformation("Starting video stream {StreamId} ({StreamName}) for car {CarId}", stream.Id, stream.Name, stream.CarId);
        await streamService.StartStreamAsync(stream.Id);

        // A first start assigns the Janus port, a TCP stream may have moved; the onboard has to send there.
        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<SignalRCContext>();
        var started = await db.CarVideoStreams.AsNoTracking().FirstAsync(s => s.Id == stream.Id);
        var car = hub.Clients.Group($"Car-{stream.CarId}");
        if (started.OnboardTargetPort != stream.OnboardTargetPort)
            await car.UpsertVideoStream(started.StreamId, ChannelMapMapper.ToMapItem(started));

        await car.StartVideoStream(started.StreamId);
        var audioPort = streamService.GetAudioPort(started.Id);
        if (audioPort != null)
            await car.StartAudioUplink(started.StreamId, audioPort.Value);
        else
            await car.StopAudioUplink(started.StreamId);
    }
}
