namespace SignalRC.Onboard.Hardware.Can;

/// <summary>
/// Wire format of the MKS XDrive Mini tracked-drive protocol.
///
/// Two drive nodes on one bus, 500 kbit/s, standard 11 bit identifiers. The
/// node id is baked into each board's firmware at build time (-e left / -e
/// right) because the strap pins are unreachable once a board is mounted.
///
/// Everything here mirrors the firmware; see Docs/CanTrackDrive.md and the
/// CAN section of the firmware's problem.md. The two must be changed together.
/// </summary>
public static class CanTrackProtocol
{
    /// <summary>Emergency stop. Any node may send it, every node obeys it.
    /// Lowest id on the bus so it wins arbitration against everything else.</summary>
    public const uint EmergencyStopId = 0x010;

    /// <summary>Drive command, master to all. Carries BOTH tracks in one frame
    /// so the nodes read the same bus instant instead of being skewed by two
    /// separate transmissions.</summary>
    public const uint CommandId = 0x100;

    public const int LeftNode = 0;
    public const int RightNode = 1;

    /// <summary>Base of a node's outgoing identifiers: 0x180 and 0x190.</summary>
    public static uint NodeBase(int node) => (uint)(0x180 + 0x10 * node);

    public static uint StatusId(int node) => NodeBase(node) + 1;
    public static uint PowerId(int node) => NodeBase(node) + 2;
    public static uint FaultId(int node) => NodeBase(node) + 3;

    public enum DriveMode : byte
    {
        /// <summary>Target zero, driver stays enabled, actively holds standstill.</summary>
        Stop = 0,
        Velocity = 1,
        /// <summary>Driver off, wheels free.</summary>
        Coast = 2,
    }

    /// <summary>Bit 0 of the command frame's flag byte: unlatch a fault.
    /// Unlatching is the master's privilege; nothing on the node re-enables
    /// itself.</summary>
    public const byte CommandFlagClearFault = 0x01;

    [Flags]
    public enum StatusFlags : byte
    {
        None = 0,
        Failsafe = 0x01,
        CurrentLimited = 0x02,
        VoltageLimited = 0x04,
        UnderVoltageWarning = 0x08,
        ThermalDerating = 0x10,
        TemperatureWarning = 0x20,
    }

    public enum NodeState : byte
    {
        Off = 0,
        Ready = 1,
        Driving = 2,
        Faulted = 3,
    }

    public enum FaultCode : byte
    {
        None = 0,
        Stall = 1,
        OverCurrent = 2,
        DriverFault = 3,
        UnderVoltage = 4,
        OverVoltage = 5,
        PeerLost = 6,
        MasterTimeout = 7,
        OverTemperature = 8,
        EmergencyStop = 0xFF,
    }

    public static string Describe(FaultCode code) => code switch
    {
        FaultCode.None => "none",
        FaultCode.Stall => "stall",
        FaultCode.OverCurrent => "overcurrent",
        FaultCode.DriverFault => "DRV8301 fault",
        FaultCode.UnderVoltage => "undervoltage",
        FaultCode.OverVoltage => "overvoltage",
        FaultCode.PeerLost => "peer lost",
        FaultCode.MasterTimeout => "master timeout",
        FaultCode.OverTemperature => "over temperature",
        FaultCode.EmergencyStop => "emergency stop",
        _ => $"unknown ({(byte)code})",
    };

    /// <summary>A temperature byte of -128 means the node has no valid reading,
    /// not -128 degrees. The thermistor node can read open or shorted.</summary>
    public const sbyte TemperatureInvalid = -128;

    // --- little endian helpers -------------------------------------------
    // Written out rather than using BitConverter so the layout is visible next
    // to the firmware's byte assembly and a mismatch is easy to spot.

    public static void WriteInt16(byte[] d, int offset, short value)
    {
        d[offset] = (byte)(value & 0xFF);
        d[offset + 1] = (byte)((value >> 8) & 0xFF);
    }

    public static void WriteUInt16(byte[] d, int offset, ushort value)
    {
        d[offset] = (byte)(value & 0xFF);
        d[offset + 1] = (byte)((value >> 8) & 0xFF);
    }

    public static short ReadInt16(byte[] d, int offset)
        => (short)(d[offset] | (d[offset + 1] << 8));

    public static ushort ReadUInt16(byte[] d, int offset)
        => (ushort)(d[offset] | (d[offset + 1] << 8));

    public static uint ReadUInt32(byte[] d, int offset)
        => (uint)(d[offset] | (d[offset + 1] << 8) | (d[offset + 2] << 16) | (d[offset + 3] << 24));

    /// <summary>Saturating conversion to the int16 the wire format uses.
    /// Clamping beats wrapping: a wrapped speed command changes sign.</summary>
    public static short ToWire(double scaled)
    {
        if (double.IsNaN(scaled)) return 0;
        if (scaled > short.MaxValue) return short.MaxValue;
        if (scaled < short.MinValue) return short.MinValue;
        return (short)Math.Round(scaled);
    }
}
