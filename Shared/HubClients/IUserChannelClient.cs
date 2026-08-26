namespace SignalRC.Shared.HubClients;

public interface IUserChannelClient
{
    Task ReceiveUserChannelValue(int userChannelId, decimal value);
}
