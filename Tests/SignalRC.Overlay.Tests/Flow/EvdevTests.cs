using SignalRC.Onboard.Input;

namespace SignalRC.Overlay.Tests.Flow;

// OF07 / T11: event layout, normalization, what counts as a controller.
public class EvdevTests
{
    [Fact]
    public void Parses_type_code_value_at_the_end_of_the_event()
    {
        var e = new byte[Evdev.EventSize];
        var o = e.Length - 8;
        BitConverter.GetBytes((ushort)Evdev.EV_ABS).CopyTo(e, o);
        BitConverter.GetBytes((ushort)0x01).CopyTo(e, o + 2);
        BitConverter.GetBytes(-300).CopyTo(e, o + 4);
        Assert.Equal((Evdev.EV_ABS, 0x01, -300), Evdev.ParseEvent(e));
    }

    [Fact]
    public void Sticks_go_to_minus_one_one_triggers_to_zero_one()
    {
        var stick = new Evdev.AbsInfo(0, -32768, 32767);
        Assert.Equal(-1, Evdev.Normalize(0x00, stick, -32768), 6);
        Assert.Equal(1, Evdev.Normalize(0x00, stick, 32767), 6);
        Assert.Equal(0, Evdev.Normalize(0x00, stick, 0), 3);

        var trigger = new Evdev.AbsInfo(0, 0, 255);
        Assert.Equal(0, Evdev.Normalize(0x05, trigger, 0), 6);   // ABS_RZ
        Assert.Equal(1, Evdev.Normalize(0x05, trigger, 255), 6);
        // A 0…255 stick (some pads) is still centered.
        Assert.Equal(-1, Evdev.Normalize(0x00, trigger, 0), 6);

        var hat = new Evdev.AbsInfo(0, -1, 1);
        Assert.Equal(-1, Evdev.Normalize(0x10, hat, -1), 6);
        Assert.Equal(0, Evdev.Normalize(0x00, new Evdev.AbsInfo(0, 5, 5), 5));
        Assert.Equal(1, Evdev.Normalize(0x00, stick, 99999), 6); // clamped
    }

    [Fact]
    public void Recognizes_gamepads_but_not_touchpads_or_motion_sensors()
    {
        Assert.True(Evdev.IsGameController([0x00, 0x01], [0x130, 0x131], null));
        Assert.True(Evdev.IsGameController([0x00], [], null));          // simple joystick
        Assert.False(Evdev.IsGameController([], [30, 31], null));       // keyboard
        var accelerometer = new byte[] { 1 << 6 };
        Assert.False(Evdev.IsGameController([0x00, 0x01, 0x02], [], accelerometer));
        var buttonpad = new byte[] { (1 << 0) | (1 << 2) };
        Assert.False(Evdev.IsGameController([0x00, 0x01], [0x110], buttonpad));
    }

    [Fact]
    public void Device_key_combines_address_and_name()
    {
        Evdev.DeviceInfo Info(string uniq, string name) => new() { Path = "/dev/input/event0", Name = name, Uniq = uniq, Vendor = 0x054c, Product = 0x09cc, Axes = new(), Keys = new() };
        Assert.Equal("aa:bb:cc:dd:ee:ff/Wireless Controller", Info("aa:bb:cc:dd:ee:ff", "Wireless Controller").Key);
        Assert.NotEqual(Info("aa:bb", "Wireless Controller").Key, Info("aa:bb", "Wireless Controller Motion Sensors").Key);
        Assert.Equal("054c:09cc/Pad", Info("", "Pad").Key);
    }

    [Fact]
    public void Names_known_codes()
    {
        Assert.Equal("ABS_RX", Evdev.AxisName(0x03));
        Assert.Equal("BTN_SOUTH", Evdev.KeyName(0x130));
        Assert.Equal("BTN_0x2c0", Evdev.KeyName(0x2c0));
    }
}
