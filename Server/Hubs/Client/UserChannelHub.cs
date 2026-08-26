using SignalRC.Server.Data;
using SignalRC.Shared.HubClients;
using SignalRC.Shared.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace SignalRC.Server.Hubs;

public class UserChannelHub : Hub<IUserChannelClient>, IUserChannelServer
{
    private readonly ILogger<UserChannelHub> _logger;
    private readonly SignalRCContext _context;

    public UserChannelHub(ILogger<UserChannelHub> logger, SignalRCContext context)
    {
        _logger = logger;
        _context = context;
        _logger.LogDebug($"UserChannelHub created");
    }

    public async Task UpdateUserChannelValue(int userChannelId, decimal value)
    {
        _logger.LogDebug($"Updating channel {userChannelId} = {value}");
        // Find the gamepad device this channel belongs to
        var channel = await _context.Set<UserChannel>().FindAsync(userChannelId);
        if (channel == null)
        {
            _logger.LogWarning($"Channel {userChannelId} not found");
            return;
        }

        _logger.LogDebug($"Broadcasting channel {userChannelId} = {value} for gamepad {channel.UserChannelDeviceId}");
        // Broadcast to all clients subscribed to this gamepad EXCEPT the sender
        await Clients.OthersInGroup($"gamepad-{channel.UserChannelDeviceId}").ReceiveUserChannelValue(userChannelId, value);
    }

    public async Task SubscribeToGamepad(int gamepadDeviceId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, $"gamepad-{gamepadDeviceId}");
        _logger.LogDebug($"Client {Context.ConnectionId} subscribed to gamepad-{gamepadDeviceId}");
    }

    public async Task UnsubscribeFromGamepad(int gamepadDeviceId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"gamepad-{gamepadDeviceId}");
        _logger.LogDebug($"Client {Context.ConnectionId} unsubscribed from gamepad-{gamepadDeviceId}");
    }
}
