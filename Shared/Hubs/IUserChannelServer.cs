namespace SignalRC.Shared.Hubs;

public interface IUserChannelServer
{
    Task UpdateUserChannelValue(int userChannelId, decimal value);
    Task SubscribeToGamepad(int gamepadDeviceId);
    Task UnsubscribeFromGamepad(int gamepadDeviceId);
}
