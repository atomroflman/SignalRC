// ReSharper disable InconsistentNaming
namespace SignalRC.Onboard.Control;

[Flags]
public enum PinFunctionFlags
{
    None,
    SDA1,
    SCL1,
    GPIO,
    UART_TXD0,
    UART_RXD0,
    PWM,
    SPI0_MOSI,
    SPI0_MISO,
    SPI0_SCLK,
    SPI0_CE0,
    SPI0_CE1,
    ID_SD,
    ID_SC
}