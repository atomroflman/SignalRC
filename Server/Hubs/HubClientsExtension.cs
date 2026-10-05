using System.Threading.Tasks;
using LteCar.Server.Data;
using Microsoft.AspNetCore.SignalR;

namespace LteCar.Server.Hubs
{
    // Extension helpers for targeting car and user clients via Hub.Clients and for managing group membership.
    public static class HubClientsExtensions
    {
        private const string CAR_GROUP_PREFIX = "car:";
        private const string USER_GROUP_PREFIX = "user:";

        public static T Car<T>(this IHubClients<T> clients, long id)
            => clients.Group(CarGroup(id));

        // Requires LteCarContext type to exist in the project.
        public static T Car<T>(this IHubClients<T> clients, string key, LteCarContext ctx)
            => clients.Group(CarGroup(key, ctx));

        // Returns the client proxy for a specific user id.
        public static IClientProxy User(this IHubClients clients, string userId)
            => clients.User(userId);

        // Hub instance helpers (use inside Hub implementations)

        public static IClientProxy Car(this Hub hub, long id)
            => hub.Clients.Car(id);

        public static IClientProxy Car(this Hub hub, string key, LteCarContext ctx)
            => hub.Clients.Car(key, ctx);

        public static IClientProxy User(this Hub hub)
        {
            var userId = hub.Context?.UserIdentifier;
            return userId is null ? hub.Clients.Caller : hub.Clients.User(userId);
        }

        // Add / Remove connection to car / user groups

        public static Task AddCarToGroupAsync(this Hub hub, long id)
            => hub.Groups.AddToGroupAsync(hub.Context.ConnectionId, CarGroup(id));

        public static Task RemoveCarFromGroupAsync(this Hub hub, long id)
            => hub.Groups.RemoveFromGroupAsync(hub.Context.ConnectionId, CarGroup(id));

        public static Task AddCarToGroupAsync(this Hub hub, string key, LteCarContext ctx)
            => hub.Groups.AddToGroupAsync(hub.Context.ConnectionId, CarGroup(key, ctx));

        public static Task RemoveCarFromGroupAsync(this Hub hub, string key, LteCarContext ctx)
            => hub.Groups.RemoveFromGroupAsync(hub.Context.ConnectionId, CarGroup(key, ctx));

        public static Task AddUserToGroupAsync(this Hub hub)
        {
            var context = hub.Context;
            var userId = context.UserIdentifier ?? context.ConnectionId;
            return hub.Groups.AddToGroupAsync(context.ConnectionId, UserGroup(userId));
        }

        public static Task RemoveUserFromGroupAsync(this Hub hub)
        {
            var context = hub.Context;
            var userId = context.UserIdentifier ?? context.ConnectionId;
            return hub.Groups.RemoveFromGroupAsync(context.ConnectionId, UserGroup(userId));
        }

        // Helpers

        private static string CarGroup(long id) => $"{CAR_GROUP_PREFIX}{id}";

        private static string CarGroup(string key, LteCarContext ctx)
        {
            var carId = ctx.Cars.FirstOrDefault(c => c.CarIdentityKey == key)?.Id
                ?? throw new InvalidOperationException($"Car with identity key '{key}' not found.");
            return $"{CAR_GROUP_PREFIX}{carId}";
        }

        private static string UserGroup(string userId) => $"{USER_GROUP_PREFIX}{userId}";
    }
}