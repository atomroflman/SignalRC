using System.Buffers;
using System.Text;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Protocol;
using Microsoft.Extensions.Logging.Abstractions;
using SignalRC.Onboard.Telemetry.LidarGrid;
using SignalRC.Server.Telemetry;
using SignalRC.Shared.Telemetry;
using static SignalRC.Overlay.Tests.Lidar.LidarTestData;

namespace SignalRC.Overlay.Tests.Lidar;

/// <summary>The grid value passes onboard → server → browser unchanged (AP03 transport).</summary>
public class LidarGridTransportTests
{
    private const int Car = 3;
    private const int GridId = 11;

    private static string GridValue()
    {
        // Dense, so the value carries every Base64 character class including '+', '/' and '='.
        var grid = new LidarGrid { Complete = false };
        for (var f = 0; f < LidarGrid.Fields; f++) grid.Mm[f] = (ushort)(f * 131 % 65000);
        return LidarGridWire.Encode(grid);
    }

    [Fact]
    public void TelemetryDeltaWithGridSurvivesTheOnboardMessagePackProtocol()
    {
        var value = GridValue();
        var delta = new TelemetryDelta
        {
            Epoch = "e", Seq = 1, AgeMs = 30,
            Changed = [new TelemetryChange { Id = GridId, Value = value, State = TelemetrySampleState.Valid }],
        };
        var protocol = new MessagePackHubProtocol();
        var bytes = protocol.GetMessageBytes(new InvocationMessage("UpdateTelemetrySamples", [delta]));

        var binder = new Binder(typeof(TelemetryDelta));
        var buffer = new ReadOnlySequence<byte>(bytes);
        Assert.True(protocol.TryParseMessage(ref buffer, binder, out var message));
        var parsed = (TelemetryDelta)((InvocationMessage)message!).Arguments[0]!;
        Assert.Equal(value, parsed.Changed.Single().Value);
    }

    [Fact]
    public async Task RelayForwardsTheGridValueVerbatimAndJsonKeepsIt()
    {
        var transport = new CapturingTransport();
        var relay = new TelemetryRelay(transport, new Directory(), TimeProvider.System, NullLogger<TelemetryRelay>.Instance);
        await relay.OnboardConnectedAsync(Car, "onboard");
        await relay.SetInterestAsync("browser", Car, [GridId]);

        var value = GridValue();
        await relay.OnDeltaAsync(Car, new TelemetryDelta
        {
            Epoch = "e", Seq = 1, AgeMs = 30,
            Changed = [new TelemetryChange { Id = GridId, Value = value, State = TelemetrySampleState.Valid }],
        });
        var changed = transport.Samples.Single().Changed.Single();
        Assert.Equal(value, changed[1]);

        // The browser speaks the SignalR JSON protocol; the plain-text value needs no nested JSON.
        var json = new JsonHubProtocol();
        var bytes = json.GetMessageBytes(new InvocationMessage("Tlm", [Car, 1L, 30, transport.Samples.Single().Changed, Array.Empty<int>(), Array.Empty<int>()]));
        var text = Encoding.UTF8.GetString(bytes.Span);
        using var doc = System.Text.Json.JsonDocument.Parse(text.TrimEnd('\u001e'));
        var received = doc.RootElement.GetProperty("arguments")[3][0][1].GetString();
        Assert.Equal(value, received);
        Assert.True(LidarGridWire.TryDecode(received, out _, out var complete));
        Assert.False(complete);
    }

    private sealed class Binder(Type argument) : IInvocationBinder
    {
        public IReadOnlyList<Type> GetParameterTypes(string methodName) => [argument];
        public Type GetReturnType(string invocationId) => typeof(object);
        public Type GetStreamItemType(string streamId) => typeof(object);
    }

    private sealed class Directory : ITelemetryChannelDirectory
    {
        public Task<IReadOnlyDictionary<int, string>> LoadAsync(int carId) =>
            Task.FromResult<IReadOnlyDictionary<int, string>>(new Dictionary<int, string> { [GridId] = "lidarGrid" });
    }

    private sealed class CapturingTransport : ITelemetryTransport
    {
        public readonly List<(string Connection, object[][] Changed)> Samples = [];

        public Task SendSamplesAsync(string connectionId, int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged)
        {
            lock (this) Samples.Add((connectionId, changed));
            return Task.CompletedTask;
        }

        public Task SendLegacyAsync(int carId, string channelName, string value) => Task.CompletedTask;
        public Task SendDemandAsync(string onboardConnectionId, int[] channelIds) => Task.CompletedTask;
    }
}
