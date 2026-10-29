namespace SignalRC.Onboard.Hardware.Lidar;

/// <summary>
/// Turns a byte stream into scans.
///
/// A framer is only worth anything if it survives a bad checksum, a stray
/// index and a byte landing in the middle of a packet - all three happen on a
/// real serial line, and the last one happens every time the port is opened
/// mid-stream.
///
/// The recovery rule matters more than it looks: on a bad packet the search
/// advances by ONE byte, not by a whole packet. 0xFA turns up inside payload
/// constantly - it is a perfectly ordinary distance or strength byte - so a
/// false start is the normal case, and skipping 22 bytes from one would throw
/// away a real packet that began two bytes later and keep the framer lost.
/// </summary>
public sealed class LdsFramer
{
    private readonly byte[] _buffer = new byte[4096];
    private int _length;

    private readonly LdsScan _scan = new();
    private int _lastIndex = -1;
    private int _packetsThisRevolution;

    public long BytesSeen { get; private set; }
    public long PacketsAccepted { get; private set; }
    public long ChecksumErrors { get; private set; }
    public long IndexErrors { get; private set; }
    /// <summary>Bytes thrown away while hunting for a packet boundary.</summary>
    public long BytesDiscarded { get; private set; }
    public long ScansCompleted { get; private set; }
    /// <summary>Degrees the last completed scan was missing.</summary>
    public int LastScanGaps { get; private set; }

    public double LastRpm { get; private set; }

    /// <summary>
    /// Feeds bytes in and calls <paramref name="onScan"/> once per completed
    /// revolution. The scan handed over belongs to the caller and is never
    /// touched again, so it can be kept, queued or handed on.
    /// </summary>
    public void Push(ReadOnlySpan<byte> data, Action<LdsScan> onScan)
    {
        BytesSeen += data.Length;

        while (data.Length > 0)
        {
            // A burst larger than the buffer is not an error, just a big read.
            var room = _buffer.Length - _length;
            if (room == 0)
            {
                // Nothing parseable in a full buffer means the stream is not
                // this protocol at all. Drop the oldest half and carry on
                // rather than wedging.
                BytesDiscarded += _buffer.Length / 2;
                Array.Copy(_buffer, _buffer.Length / 2, _buffer, 0, _buffer.Length / 2);
                _length = _buffer.Length / 2;
                room = _buffer.Length - _length;
            }
            var take = Math.Min(room, data.Length);
            data[..take].CopyTo(_buffer.AsSpan(_length));
            _length += take;
            data = data[take..];

            Parse(onScan);
        }
    }

    private void Parse(Action<LdsScan> onScan)
    {
        var at = 0;
        while (_length - at >= LdsProtocol.PacketLength)
        {
            if (_buffer[at] != LdsProtocol.StartByte)
            {
                at++;
                BytesDiscarded++;
                continue;
            }

            var packet = _buffer.AsSpan(at, LdsProtocol.PacketLength);
            if (!LdsProtocol.ChecksumOk(packet))
            {
                ChecksumErrors++;
                at++;              // one byte, see the class remarks
                BytesDiscarded++;
                continue;
            }

            var index = packet[1];
            if (!LdsProtocol.IsValidIndex(index))
            {
                // Checksum passed but the index is impossible. Rare, and worth
                // its own counter: it points at the module, not at the link.
                IndexErrors++;
                at += LdsProtocol.PacketLength;
                continue;
            }

            Accept(packet, index, onScan);
            at += LdsProtocol.PacketLength;
        }

        if (at > 0)
        {
            _length -= at;
            Array.Copy(_buffer, at, _buffer, 0, _length);
        }
    }

    private void Accept(ReadOnlySpan<byte> packet, byte index, Action<LdsScan> onScan)
    {
        PacketsAccepted++;

        var packetNumber = index - LdsProtocol.IndexFirst;
        // A revolution ends when the index stops climbing. Detected from the
        // index rather than from elapsed time, so a dropped packet shortens a
        // scan instead of merging two.
        if (_lastIndex >= 0 && packetNumber <= _lastIndex)
        {
            Complete(onScan);
        }
        _lastIndex = packetNumber;
        _packetsThisRevolution++;

        LastRpm = (packet[2] | (packet[3] << 8)) * LdsProtocol.SpeedRawToRpm;

        var baseAngle = packetNumber * LdsProtocol.SamplesPerPacket;
        for (var i = 0; i < LdsProtocol.SamplesPerPacket; i++)
        {
            var o = 4 + i * 4;
            var distanceWord = (ushort)(packet[o] | (packet[o + 1] << 8));
            var strength = packet[o + 2] | (packet[o + 3] << 8);
            var angle = baseAngle + i;

            if ((distanceWord & LdsProtocol.NoReturnFlag) != 0)
            {
                // Open space or a surface that scattered nothing back. Left as
                // Missing: it is the absence of an obstacle, not one at 0 mm.
                _scan.DistanceMm[angle] = LdsScan.Missing;
                _scan.Strength[angle] = 0;
                continue;
            }

            // A weak return is kept, with its strength, because a dark or
            // glancing surface is still a surface. Whoever consumes this can
            // decide how much to trust it.
            _scan.DistanceMm[angle] = distanceWord & LdsProtocol.DistanceMask;
            _scan.Strength[angle] = strength;
            _scan.ValidCount++;
        }
    }

    private void Complete(Action<LdsScan> onScan)
    {
        _scan.Rpm = LastRpm;
        _scan.CompletedUtc = DateTime.UtcNow;
        LastScanGaps = _scan.Gaps;
        ScansCompleted++;
        onScan(_scan.Snapshot());
        _scan.Clear();
        _packetsThisRevolution = 0;
    }
}
