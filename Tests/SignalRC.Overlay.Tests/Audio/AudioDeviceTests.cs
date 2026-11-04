using SignalRC.Onboard;
using SignalRC.Onboard.Services;

namespace SignalRC.Overlay.Tests.Audio;

/// <summary>Device detection and device test of the setup page, with output captured on a real vehicle.</summary>
public class AudioDeviceTests
{
    [Fact]
    public void HardwareListFindsAUsbMicrophone()
    {
        const string output = """
            **** List of CAPTURE Hardware Devices ****
            card 2: Device [USB PnP Sound Device], device 0: USB Audio [USB Audio]
              Subdevices: 1/1
              Subdevice #0: subdevice #0
            """;
        var device = Assert.Single(AvailableChannelTypesService.ListHardwareDevices(output));
        Assert.Equal("plughw:CARD=Device,DEV=0", device.Name);
        Assert.Equal("USB PnP Sound Device, USB Audio", device.Description);
    }

    [Fact]
    public void NamedListSkipsPluginAliases()
    {
        const string output = "null\n    Discard all samples\nhw:CARD=Device,DEV=0\n    USB PnP Sound Device, USB Audio\ndsnoop:CARD=Device,DEV=0\n    Direct sample snooping device\n";
        var device = Assert.Single(AvailableChannelTypesService.ListNamedDevices(output));
        Assert.Equal("hw:CARD=Device,DEV=0", device.Name);
    }

    [Theory]
    [InlineData("plughw:CARD=Device,DEV=0", true)]
    [InlineData("default", true)]
    [InlineData("sysdefault:CARD=vc4hdmi0", true)]
    [InlineData("--help", false)]
    [InlineData("-D", false)]
    [InlineData("a b", false)]
    [InlineData("x;reboot", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void OnlyAlsaNamesReachTheTools(string? device, bool valid) =>
        Assert.Equal(valid, AudioService.IsValidDeviceName(device));

    [Fact]
    public void LevelIsMeasuredInDecibelsBelowFullScale()
    {
        // Peak 4363 of 32768, the level of the probe recording on the truck.
        var pcm = new byte[] { 0, 0, 0x0B, 0x11, 0, 0, 0xF5, 0xEE };
        var (peak, rms) = AudioService.MeasureLevel(pcm);
        Assert.Equal(-17.5, peak);
        Assert.Equal(-20.5, rms);
    }

    [Fact]
    public void SilenceHasNoLevel()
    {
        Assert.Equal((null, null), AudioService.MeasureLevel(new byte[100]));
        Assert.Equal((null, null), AudioService.MeasureLevel([]));
    }

    [Fact]
    public void TestToneIsOneStereoSecondAndAudibleButNotLoud()
    {
        var tone = AudioService.BuildTestTone();
        Assert.Equal(48000 * 4, tone.Length);
        var (peak, _) = AudioService.MeasureLevel(tone);
        Assert.InRange(peak!.Value, -13, -11);
    }
}
