using System.Collections.Concurrent;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.Connections.Features;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;
using SignalRC.Server.Configuration;
using SignalRC.Server.Services;
using SignalRC.Shared.HubClients;

namespace SignalRC.Overlay.Tests.Security;

/// <summary>Hub caller of a given connection, optionally signed in as a session user.</summary>
public sealed class FakeCaller(string connectionId, HttpContext http) : HubCallerContext
{
    private readonly FeatureCollection _features = new();
    public override string ConnectionId => connectionId;
    public override string? UserIdentifier => null;
    public override ClaimsPrincipal? User => http.User;
    public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
    public override IFeatureCollection Features
    {
        get
        {
            _features.Set<IHttpContextFeature>(new HttpFeature { HttpContext = http });
            return _features;
        }
    }
    public override CancellationToken ConnectionAborted => CancellationToken.None;
    public override void Abort() { }

    private sealed class HttpFeature : IHttpContextFeature
    {
        public HttpContext? HttpContext { get; set; }
    }
}

/// <summary>Records every client call as "target:Method" and group membership.</summary>
public sealed class RecordingHubClients : RecordingHubClients<IConnectionHubClient>;

public class RecordingHubClients<T> : IHubCallerClients<T>, IGroupManager where T : class
{
    public readonly ConcurrentQueue<string> Calls = new();
    public readonly ConcurrentQueue<(string Connection, string Group)> GroupAdds = new();

    private T Proxy(string target) => RecordingClient<T>.Create(target, Calls);

    public T All => Proxy("all");
    public T Caller => Proxy("caller");
    public T Others => Proxy("others");
    public T AllExcept(IReadOnlyList<string> excludedConnectionIds) => Proxy("allExcept");
    public T Client(string connectionId) => Proxy($"client:{connectionId}");
    public T Clients(IReadOnlyList<string> connectionIds) => Proxy("clients");
    public T Group(string groupName) => Proxy($"group:{groupName}");
    public T GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => Proxy($"group:{groupName}");
    public T Groups(IReadOnlyList<string> groupNames) => Proxy("groups");
    public T OthersInGroup(string groupName) => Proxy($"group:{groupName}");
    public T User(string userId) => Proxy($"user:{userId}");
    public T Users(IReadOnlyList<string> userIds) => Proxy("users");

    public Task AddToGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default)
    {
        GroupAdds.Enqueue((connectionId, groupName));
        return Task.CompletedTask;
    }

    public Task RemoveFromGroupAsync(string connectionId, string groupName, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

public class RecordingClient<T> : DispatchProxy where T : class
{
    private string _target = "";
    private ConcurrentQueue<string> _calls = null!;

    public static T Create(string target, ConcurrentQueue<string> calls)
    {
        var proxy = Create<T, RecordingClient<T>>();
        var recording = (RecordingClient<T>)(object)proxy;
        recording._target = target;
        recording._calls = calls;
        return proxy;
    }

    protected override object? Invoke(MethodInfo? method, object?[]? args)
    {
        _calls.Enqueue($"{_target}:{method!.Name}");
        var type = method.ReturnType;
        if (type == typeof(Task)) return Task.CompletedTask;
        if (type.IsGenericType && type.GetGenericTypeDefinition() == typeof(Task<>))
        {
            var result = type.GetGenericArguments()[0];
            var value = result.IsValueType ? Activator.CreateInstance(result) : null;
            return typeof(Task).GetMethod(nameof(Task.FromResult))!.MakeGenericMethod(result).Invoke(null, [value]);
        }
        return null;
    }
}

public sealed class FakeConfigurationService : IConfigurationService
{
    public ApplicationConfiguration Application { get; } = new();
    public JanusConfiguration Janus { get; } = new();
    public FileTransferConfiguration FileTransfer { get; } = new();
    public WebRtcConfiguration WebRtc { get; } = new();
    public string DefaultConnectionString => "";
}
