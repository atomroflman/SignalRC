using System.Buffers.Binary;
using System.Text;

namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Turns the Pico's byte stream into scans, status and log lines.
///
/// Simpler than it would be against the raw sensor: the Pico has already
/// assembled the revolution, so there is no 90-frame reassembly here, no
/// angle bookkeeping and no per-frame checksum. One CRC decides whether a
/// whole revolution is good.
///
/// Recovery advances by ONE byte on a bad frame. The LD pair turns up inside
/// payload constantly - 0x4C and 0x44 are ordinary distance bytes - so a
/// false start is the normal case, and skipping a whole frame from one would
/// discard a real frame that began two bytes later.
/// </summary>
public sealed class LidarFramer
{
    // Two frames plus slack: a scan is 2903 bytes, and a read can straddle
    // any boundary.
    private readonly byte[] _buffer = new byte[8192];
    private int _length;
    private readonly LidarScan _scan = new();

    public long BytesSeen { get; private set; }
    public long ScansDecoded { get; private set; }
    public long StatusDecoded { get; private set; }
    public long LogsDecoded { get; private set; }
    public long CrcErrors { get; private set; }
    /// <summary>Bytes thrown away while hunting for a frame boundary. A
    /// handful at startup is the partial frame the port opened in the middle
    /// of; a steadily climbing count means something else is reading the same
    /// port, which is how the first capture on this hardware went wrong.</summary>
    public long BytesDiscarded { get; private set; }
    public long OversizeRejected { get; private set; }

    public void Push(ReadOnlySpan<byte> data,
                     Action<LidarScan>? onScan = null,
                     Action<LidarStatus>? onStatus = null,
                     Action<string>? onLog = null)
    {
        BytesSeen += data.Length;

        while (data.Length > 0)
        {
            var room = _buffer.Length - _length;
            if (room == 0)
            {
                // Nothing parseable in a full buffer means this is not the
                // protocol at all. Drop the oldest half rather than wedge.
                var half = _buffer.Length / 2;
                BytesDiscarded += half;
                Array.Copy(_buffer, half, _buffer, 0, half);
                _length = half;
                room = half;
            }
            var take = Math.Min(room, data.Length);
            data[..take].CopyTo(_buffer.AsSpan(_length));
            _length += take;
            data = data[take..];

            Parse(onScan, onStatus, onLog);
        }
    }

    private void Parse(Action<LidarScan>? onScan, Action<LidarStatus>? onStatus,
                       Action<string>? onLog)
    {
        var at = 0;
        while (_length - at >= LidarProtocol.HeaderLength + LidarProtocol.CrcLength)
        {
            if (_buffer[at] != LidarProtocol.Sync0 || _buffer[at + 1] != LidarProtocol.Sync1)
            {
                at++;
                BytesDiscarded++;
                continue;
            }

            var payloadLength = BinaryPrimitives.ReadUInt16LittleEndian(_buffer.AsSpan(at + 3, 2));
            if (payloadLength > LidarProtocol.MaxPayload)
            {
                OversizeRejected++;
                at++;
                BytesDiscarded++;
                continue;
            }

            var total = LidarProtocol.HeaderLength + payloadLength + LidarProtocol.CrcLength;
            if (_length - at < total) break; // wait for the rest

            // The CRC spans the type and the length too, so a corrupted length
            // cannot pass as a valid header.
            var covered = _buffer.AsSpan(at + 2, 1 + 2 + payloadLength);
            var expected = BinaryPrimitives.ReadUInt16LittleEndian(
                _buffer.AsSpan(at + LidarProtocol.HeaderLength + payloadLength, 2));
            if (LidarProtocol.Crc16(covered) != expected)
            {
                CrcErrors++;
                at++;              // one byte, see the class remarks
                BytesDiscarded++;
                continue;
            }

            Dispatch(_buffer[at + 2],
                     _buffer.AsSpan(at + LidarProtocol.HeaderLength, payloadLength),
                     onScan, onStatus, onLog);
            at += total;
        }

        if (at > 0)
        {
            _length -= at;
            Array.Copy(_buffer, at, _buffer, 0, _length);
        }
    }

    private void Dispatch(byte type, ReadOnlySpan<byte> payload,
                          Action<LidarScan>? onScan, Action<LidarStatus>? onStatus,
                          Action<string>? onLog)
    {
        switch (type)
        {
            case LidarProtocol.MsgScan when payload.Length >= LidarProtocol.ScanPayloadLength:
                DecodeScan(payload);
                ScansDecoded++;
                onScan?.Invoke(_scan.Snapshot());
                break;

            case LidarProtocol.MsgStatus when payload.Length >= LidarProtocol.StatusPayloadLength:
                StatusDecoded++;
                onStatus?.Invoke(DecodeStatus(payload));
                break;

            case LidarProtocol.MsgLog:
                LogsDecoded++;
                onLog?.Invoke(Encoding.UTF8.GetString(payload));
                break;
        }
    }

    private void DecodeScan(ReadOnlySpan<byte> p)
    {
        _scan.Sequence = BinaryPrimitives.ReadUInt32LittleEndian(p[..4]);
        _scan.PicoTimeMs = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(4, 4));
        _scan.Rpm = BinaryPrimitives.ReadUInt16LittleEndian(p.Slice(8, 2)) * LidarProtocol.SpeedRawToRpm;
        _scan.PointsValid = BinaryPrimitives.ReadUInt16LittleEndian(p.Slice(10, 2));
        _scan.Frames = p[12];
        _scan.MissingFrames = p[13];
        _scan.Complete = (BinaryPrimitives.ReadUInt16LittleEndian(p.Slice(14, 2)) & 1) != 0;
        _scan.ReceivedUtc = DateTime.UtcNow;

        var usable = 0;
        var d = p[16..];
        for (var i = 0; i < LidarProtocol.PointsPerRevolution; i++)
        {
            var mm = BinaryPrimitives.ReadUInt16LittleEndian(d.Slice(i * 2, 2));
            // Zero is "no return", and so is anything from 32000 up - the
            // sensor uses large values for that as well. Neither is an
            // obstacle; both become Missing so that nothing downstream has to
            // remember the convention.
            if (mm == 0 || mm >= LidarProtocol.NoReturnThresholdMm)
            {
                _scan.DistanceMm[i] = LidarScan.Missing;
            }
            else
            {
                _scan.DistanceMm[i] = mm;
                usable++;
            }
        }
        _scan.UsableCount = usable;
    }

    private static LidarStatus DecodeStatus(ReadOnlySpan<byte> p) => new()
    {
        UptimeMs = BinaryPrimitives.ReadUInt32LittleEndian(p[..4]),
        BytesRx = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(4, 4)),
        FramesOk = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(8, 4)),
        FramesBad = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(12, 4)),
        IdleFrames = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(16, 4)),
        Scans = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(20, 4)),
        ScansDropped = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(24, 4)),
        UartOverruns = BinaryPrimitives.ReadUInt32LittleEndian(p.Slice(28, 4)),
        SpeedRaw = BinaryPrimitives.ReadUInt16LittleEndian(p.Slice(32, 2)),
        IdleMm = BinaryPrimitives.ReadUInt16LittleEndian(p.Slice(34, 2)),
        State = (LidarProtocol.PicoState)p[36],
        PowerOn = p[37] != 0,
        AckSeen = p[38] != 0,
        ProtocolVersion = p[39],
    };
}
