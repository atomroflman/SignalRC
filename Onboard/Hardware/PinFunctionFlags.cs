// ReSharper disable InconsistentNaming
namespace SignalRC.Onboard.Control;

/// <summary>
/// What a header pin can do. Real flags: a pin is usually GPIO plus one
/// alternate function (I2C, UART, SPI, PWM).
/// </summary>
[Flags]
public enum PinFunctionFlags
{
    None = 0,
    SDA1 = 1 << 0,
    SCL1 = 1 << 1,
    GPIO = 1 << 2,
    UART_TXD0 = 1 << 3,
    UART_RXD0 = 1 << 4,
    PWM = 1 << 5,
    SPI0_MOSI = 1 << 6,
    SPI0_MISO = 1 << 7,
    SPI0_SCLK = 1 << 8,
    SPI0_CE0 = 1 << 9,
    SPI0_CE1 = 1 << 10,
    ID_SD = 1 << 11,
    ID_SC = 1 << 12,
}
