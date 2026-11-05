namespace SignalRC.Onboard.Hardware.Can;

/// <summary>
/// Wire format of the MKS XDrive Mini tracked-drive protocol.
///
/// Two drive nodes on one bus, 500 kbit/s, standard 11 bit identifiers. The
/// node id is baked into each board's firmware at build time (-e left / -e
/// right) because the strap pins are unreachable once a board is mounted.
///
/// Everything here mirrors the firmware; the binding reference is the
/// firmware's SCHNITTSTELLE.md, the reasoning on this side is in
/// Docs/CanTrackDrive.md. The two must be changed together.
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

    /// <summary>Limit request, master to all. Upper bounds for current and
    /// speed per side; they only ever lower what thermal and undervoltage
    /// derating allow. Not stored on the node and dropped on master timeout,
    /// so it is repeated at 1 Hz. Firmware 2026-11-05 and later; older
    /// firmware ignores the frame.</summary>
    public const uint LimitRequestId = 0x101;

    /// <summary>"No request" in a limit field of <see cref="LimitRequestId"/>:
    /// the firmware maximum applies. A negative value means the same.</summary>
    public const short LimitNone = short.MaxValue;

    public const int LeftNode = 0;
    public const int RightNode = 1;

    /// <summary>Base of a node's outgoing identifiers: 0x180 and 0x190.</summary>
    public static uint NodeBase(int node) => (uint)(0x180 + 0x10 * node);

    public static uint StatusId(int node) => NodeBase(node) + 1;
    public static uint PowerId(int node) => NodeBase(node) + 2;
    public static uint FaultId(int node) => NodeBase(node) + 3;
    /// <summary>Diagnostics. Steers nothing; it is what makes an incident
    /// explainable afterwards.</summary>
    public static uint DiagId(int node) => NodeBase(node) + 4;
    /// <summary>Effective limits and why they are what they are, plus a
    /// counter that acknowledges <see cref="LimitRequestId"/>.</summary>
    public static uint LimitsId(int node) => NodeBase(node) + 5;

    public enum DriveMode : byte
    {
        /// <summary>Target zero. The velocity loop brakes to standstill; since
        /// firmware 2026-11-04 the node then parks by itself (bridge off, gate
        /// driver awake, short-circuit brake if enabled locally).</summary>
        Stop = 0,
        Velocity = 1,
        /// <summary>Driver off, gate driver in standby, wheels free. No brake.</summary>
        Coast = 2,
        /// <summary>Park at once without the velocity loop; below 2 rad/s the
        /// low sides short the windings. Firmware 2026-11-04 and later; older
        /// firmware treats it like Velocity with the frame's target.</summary>
        Brake = 3,
    }

    /// <summary>Bit 0 of the command frame's flag byte: unlatch a fault.
    /// Unlatching is the master's privilege; nothing on the node re-enables
    /// itself. The node clears on EVERY frame carrying the bit, so a bit left
    /// set would defeat the latch - set it in exactly one frame.</summary>
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
        /// <summary>The short-circuit brake is engaged right now.</summary>
        ShortBrake = 0x40,
        /// <summary>The short-circuit brake let go on overcurrent; the wheel
        /// free-wheels until the next drive command.</summary>
        BrakeTripped = 0x80,
    }

    /// <summary>Byte 6 of the limits frame: what is holding a limit down.</summary>
    [Flags]
    public enum LimitReasons : byte
    {
        None = 0,
        /// <summary>The I2t model limits the current.</summary>
        ThermalI2t = 0x01,
        /// <summary>The board temperature limits the current.</summary>
        Temperature = 0x02,
        /// <summary>Undervoltage (Vbus below 32 V) limits the speed.</summary>
        UnderVoltage = 0x04,
        /// <summary>The current request from 0x101 is in effect.</summary>
        CurrentRequest = 0x08,
        /// <summary>The speed request from 0x101 is in effect.</summary>
        SpeedRequest = 0x10,
        /// <summary>The target is being clipped to the speed limit right now.</summary>
        SpeedCapped = 0x20,
    }

    public static string Describe(LimitReasons reasons)
    {
        if (reasons == LimitReasons.None) return string.Empty;
        var parts = new List<string>(6);
        if (reasons.HasFlag(LimitReasons.ThermalI2t)) parts.Add("i2t");
        if (reasons.HasFlag(LimitReasons.Temperature)) parts.Add("temperature");
        if (reasons.HasFlag(LimitReasons.UnderVoltage)) parts.Add("undervoltage");
        if (reasons.HasFlag(LimitReasons.CurrentRequest)) parts.Add("current request");
        if (reasons.HasFlag(LimitReasons.SpeedRequest)) parts.Add("speed request");
        if (reasons.HasFlag(LimitReasons.SpeedCapped)) parts.Add("speed capped");
        return string.Join(", ", parts);
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
        /// <summary>I2t above 150 % for 10 s: persistently over the continuous
        /// current despite derating. Firmware 2026-11-05 and later.</summary>
        Overload = 9,
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
        FaultCode.Overload => "overload",
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
