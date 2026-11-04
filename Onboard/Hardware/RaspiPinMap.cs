// ReSharper disable InconsistentNaming
namespace SignalRC.Onboard.Control;

/// <summary>
/// The Raspberry Pi 40-pin header (all models since the B+, Pi 5 included).
///
/// Addresses of the <c>RaspberryPiGpioManager</c> are <b>physical</b> header
/// pins (1–40), as printed on pinout charts; this map turns them into the BCM
/// line number the GPIO driver needs. The client draws the same header
/// (Client/src/components/config/raspberry-pi-header.ts) - keep both in sync.
///
/// <code>
///  1  3.3V               2  5V
///  3  GPIO 2  (SDA1)     4  5V
///  5  GPIO 3  (SCL1)     6  GND
///  7  GPIO 4             8  GPIO 14 (TXD0)
///  9  GND               10  GPIO 15 (RXD0)
/// 11  GPIO 17           12  GPIO 18 (PWM0)
/// 13  GPIO 27           14  GND
/// 15  GPIO 22           16  GPIO 23
/// 17  3.3V              18  GPIO 24
/// 19  GPIO 10 (MOSI)    20  GND
/// 21  GPIO 9  (MISO)    22  GPIO 25
/// 23  GPIO 11 (SCLK)    24  GPIO 8  (CE0)
/// 25  GND               26  GPIO 7  (CE1)
/// 27  ID_SD             28  ID_SC
/// 29  GPIO 5            30  GND
/// 31  GPIO 6            32  GPIO 12 (PWM0)
/// 33  GPIO 13 (PWM1)    34  GND
/// 35  GPIO 19 (PWM1)    36  GPIO 16
/// 37  GPIO 26           38  GPIO 20
/// 39  GND               40  GPIO 21
/// </code>
///
/// UART, SPI and I2C pins are plain GPIOs as long as that interface is not
/// enabled, so they carry the GPIO flag. ID_SD/ID_SC (BCM 0/1) belong to the
/// HAT EEPROM and are deliberately not offered.
/// </summary>
public static class RaspberryPiPinMap
{
    public sealed record HeaderPin(int Physical, int? Bcm, PinFunctionFlags Functions, string Label);

    private const PinFunctionFlags G = PinFunctionFlags.GPIO;

    public static readonly IReadOnlyList<HeaderPin> Pins =
    [
        new(1, null, PinFunctionFlags.None, "3.3V"),
        new(2, null, PinFunctionFlags.None, "5V"),
        new(3, 2, G | PinFunctionFlags.SDA1, "GPIO 2 (SDA1)"),
        new(4, null, PinFunctionFlags.None, "5V"),
        new(5, 3, G | PinFunctionFlags.SCL1, "GPIO 3 (SCL1)"),
        new(6, null, PinFunctionFlags.None, "GND"),
        new(7, 4, G, "GPIO 4"),
        new(8, 14, G | PinFunctionFlags.UART_TXD0, "GPIO 14 (TXD0)"),
        new(9, null, PinFunctionFlags.None, "GND"),
        new(10, 15, G | PinFunctionFlags.UART_RXD0, "GPIO 15 (RXD0)"),
        new(11, 17, G, "GPIO 17"),
        new(12, 18, G | PinFunctionFlags.PWM, "GPIO 18 (PWM0)"),
        new(13, 27, G, "GPIO 27"),
        new(14, null, PinFunctionFlags.None, "GND"),
        new(15, 22, G, "GPIO 22"),
        new(16, 23, G, "GPIO 23"),
        new(17, null, PinFunctionFlags.None, "3.3V"),
        new(18, 24, G, "GPIO 24"),
        new(19, 10, G | PinFunctionFlags.SPI0_MOSI, "GPIO 10 (MOSI)"),
        new(20, null, PinFunctionFlags.None, "GND"),
        new(21, 9, G | PinFunctionFlags.SPI0_MISO, "GPIO 9 (MISO)"),
        new(22, 25, G, "GPIO 25"),
        new(23, 11, G | PinFunctionFlags.SPI0_SCLK, "GPIO 11 (SCLK)"),
        new(24, 8, G | PinFunctionFlags.SPI0_CE0, "GPIO 8 (CE0)"),
        new(25, null, PinFunctionFlags.None, "GND"),
        new(26, 7, G | PinFunctionFlags.SPI0_CE1, "GPIO 7 (CE1)"),
        new(27, 0, PinFunctionFlags.ID_SD, "ID_SD"),
        new(28, 1, PinFunctionFlags.ID_SC, "ID_SC"),
        new(29, 5, G, "GPIO 5"),
        new(30, null, PinFunctionFlags.None, "GND"),
        new(31, 6, G, "GPIO 6"),
        new(32, 12, G | PinFunctionFlags.PWM, "GPIO 12 (PWM0)"),
        new(33, 13, G | PinFunctionFlags.PWM, "GPIO 13 (PWM1)"),
        new(34, null, PinFunctionFlags.None, "GND"),
        new(35, 19, G | PinFunctionFlags.PWM, "GPIO 19 (PWM1)"),
        new(36, 16, G, "GPIO 16"),
        new(37, 26, G, "GPIO 26"),
        new(38, 20, G, "GPIO 20"),
        new(39, null, PinFunctionFlags.None, "GND"),
        new(40, 21, G, "GPIO 21"),
    ];

    /// <summary>The header pin with this physical number, or null outside 1–40.</summary>
    public static HeaderPin? Find(int physical) =>
        physical is >= 1 and <= 40 ? Pins[physical - 1] : null;
}
