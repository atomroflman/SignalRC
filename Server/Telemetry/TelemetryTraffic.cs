using System.Buffers;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Protocol;
using SignalRC.Shared.Telemetry;

namespace SignalRC.Server.Telemetry;

/// <summary>
/// Messages, bytes and "real" bytes over a sliding window of 250 ms buckets.
/// Bytes are averaged over the measured messages of the window and scaled to
/// the message rate, so a window that is only partly measured still gives a
/// usable figure. Not thread-safe; the owner locks.
/// </summary>
public sealed class RateWindow
{
    public const long WindowMs = 5000;
    private const long BucketMs = 250;
    private const int Buckets = (int)(WindowMs / BucketMs);

    private readonly long[] _start = Enumerable.Repeat(long.MinValue, Buckets).ToArray();
    private readonly long[] _count = new long[Buckets], _measured = new long[Buckets], _bytes = new long[Buckets], _real = new long[Buckets];

    public long Messages { get; private set; }
    public long MeasuredMessages { get; private set; }
    public long Bytes { get; private set; }
    public long RealBytes { get; private set; }

    /// <summary>One message; <paramref name="bytes"/> &lt; 0 = not measured.</summary>
    public void Add(long nowMs, long bytes = -1, long realBytes = -1)
    {
        var start = nowMs - nowMs % BucketMs;
        var i = (int)(start / BucketMs % Buckets);
        if (_start[i] != start)
        {
            _start[i] = start;
            _count[i] = _measured[i] = _bytes[i] = _real[i] = 0;
        }
        _count[i]++;
        Messages++;
        if (bytes < 0) return;
        _measured[i]++;
        _bytes[i] += bytes;
        _real[i] += realBytes;
        MeasuredMessages++;
        Bytes += bytes;
        RealBytes += realBytes;
    }

    /// <summary>Rates over the window; <paramref name="sinceMs"/> shortens the span right after a start.</summary>
    public TrafficRate Rate(long nowMs, long sinceMs)
    {
        long count = 0, measured = 0, bytes = 0, real = 0;
        for (var i = 0; i < Buckets; i++)
        {
            if (_start[i] == long.MinValue || _start[i] <= nowMs - WindowMs || _start[i] > nowMs) continue;
            count += _count[i];
            measured += _measured[i];
            bytes += _bytes[i];
            real += _real[i];
        }
        // Covered time: from the start of the oldest bucket still counted (or the start) to now.
        var lower = ((long)Math.Floor((nowMs - WindowMs) / (double)BucketMs) + 1) * BucketMs;
        var span = Math.Clamp(Math.Min(nowMs - lower, nowMs - sinceMs), 1000, WindowMs) / 1000.0;
        var perSecond = count / span;
        return new TrafficRate(
            Math.Round(perSecond, 2),
            measured == 0 ? null : Math.Round(bytes / (double)measured * perSecond, 1),
            measured == 0 ? null : Math.Round(real / (double)measured * perSecond, 1),
            new TrafficTotal(Messages, MeasuredMessages, Bytes, RealBytes));
    }
}

public sealed record TrafficTotal(long Messages, long MeasuredMessages, long Bytes, long RealBytes);

/// <summary>Per second over the window; bytes null when nothing in the window was measured.</summary>
public sealed record TrafficRate(double PerSecond, double? BytesPerSecond, double? RealBytesPerSecond, TrafficTotal Total);

public sealed record ClientTraffic(double PerSecond, double? BytesPerSecond, long Messages, long Bytes);

public sealed record TelemetryTrafficSnapshot(
    long WindowMs,
    bool Measuring,
    long? MeasuringSinceAgoMs,
    TrafficRate Incoming,
    TrafficRate Outgoing,
    IReadOnlyList<ClientTraffic> Clients)
{
    /// <summary>How bytes are obtained: the hub has only the deserialised arguments, so frames are re-serialised.</summary>
    public string IncomingMeasure => "messagepack-reserialized";
    public string OutgoingMeasure => "json-reserialized";
    /// <summary>SignalR on Kestrel does not negotiate permessage-deflate (WebSocketAcceptContext.DangerousEnableCompression is off).</summary>
    public string Compression => "none";
}

/// <summary>
/// Traffic of one vehicle's telemetry (Shared/Overlay/telemetry/README.md §5
/// "Diagnose"): onboard → server deltas and server → browser Tlm. Messages are
/// always counted; bytes are measured (re-serialised with the hub protocols)
/// only while the diagnostics endpoint was asked within <see cref="WatchTimeout"/>.
/// </summary>
public sealed class TelemetryTraffic
{
    public static readonly TimeSpan WatchTimeout = TimeSpan.FromSeconds(30);

    // Same protocols as the hub (Program.cs: AddMessagePackProtocol, AddJsonProtocol without options).
    private static readonly MessagePackHubProtocol MessagePack = new();
    private static readonly JsonHubProtocol Json = new();
    /// <summary>A typical invocation id; the onboard calls through a typed proxy (InvokeAsync).</summary>
    private const string TypicalInvocationId = "1000";

    private readonly long _since;
    private long _watchedAt = long.MinValue;
    private long _measuringSince = long.MinValue;
    private readonly RateWindow _in = new(), _out = new();
    private readonly Dictionary<string, RateWindow> _clients = [];

    public TelemetryTraffic(long nowMs) => _since = nowMs;

    public bool Measuring(long nowMs) => _watchedAt != long.MinValue && nowMs - _watchedAt < WatchTimeout.TotalMilliseconds;

    public void Watch(long nowMs)
    {
        if (!Measuring(nowMs)) _measuringSince = nowMs;
        _watchedAt = nowMs;
    }

    public void Incoming(long nowMs, long bytes = -1, long realBytes = -1) => _in.Add(nowMs, bytes, realBytes);

    public void Outgoing(long nowMs, string connectionId, long bytes = -1, long realBytes = -1)
    {
        _out.Add(nowMs, bytes, realBytes);
        if (!_clients.TryGetValue(connectionId, out var w)) _clients[connectionId] = w = new RateWindow();
        w.Add(nowMs, bytes, realBytes);
    }

    public void Forget(string connectionId) => _clients.Remove(connectionId);

    /// <summary>Rates per direction; clients anonymous, busiest first.</summary>
    public TelemetryTrafficSnapshot Snapshot(long nowMs)
    {
        var clients = _clients.Values.Select(w => w.Rate(nowMs, _since))
            .Select(r => new ClientTraffic(r.PerSecond, r.BytesPerSecond, r.Total.Messages, r.Total.Bytes))
            .OrderByDescending(c => c.Messages).ToList();
        var measuring = Measuring(nowMs);
        return new TelemetryTrafficSnapshot(
            RateWindow.WindowMs,
            measuring,
            measuring ? nowMs - _measuringSince : null,
            _in.Rate(nowMs, _since),
            _out.Rate(nowMs, _since),
            clients);
    }

    // --- Measuring ---

    /// <summary>Length of the MessagePack frame of UpdateTelemetrySamples(delta), as the onboard sends it.</summary>
    public static int MessagePackBytes(TelemetryDelta delta) =>
        FrameLength(MessagePack, new InvocationMessage(TypicalInvocationId, "UpdateTelemetrySamples", [delta]));

    /// <summary>Length of the JSON frame of Tlm, as the hub sends it to a browser (JSON protocol, incl. record separator).</summary>
    public static int TlmJsonBytes(int carId, long seq, int ageMs, object[][] changed, int[] touched, int[] touchedAged) =>
        FrameLength(Json, new InvocationMessage("Tlm", [carId, seq, ageMs, changed, touched, touchedAged]));

    private static int FrameLength(IHubProtocol protocol, HubMessage message)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        protocol.WriteMessage(message, buffer);
        return buffer.WrittenCount;
    }

    /// <summary>One fully described value of the "real" size.</summary>
    public readonly record struct FullValue(int Id, string? Name, string Value, TelemetrySampleState State, int AgeMs);

    /// <summary>
    /// "Real" size: every contained value sent in full, as a JSON array of
    /// { id, name, value, state, ageMs } – confirmations included with their value.
    /// </summary>
    public static int RealJsonBytes(IEnumerable<FullValue> values)
    {
        var buffer = new ArrayBufferWriter<byte>(256);
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartArray();
            foreach (var v in values)
            {
                w.WriteStartObject();
                w.WriteNumber("id", v.Id);
                w.WriteString("name", v.Name);
                w.WriteString("value", v.Value);
                w.WriteString("state", v.State.ToString());
                w.WriteNumber("ageMs", v.AgeMs);
                w.WriteEndObject();
            }
            w.WriteEndArray();
        }
        return buffer.WrittenCount;
    }
}
