// ReSharper disable InconsistentNaming
namespace SignalRC.Onboard.Control;

/// <summary>
/// Represents the GPIO pin mapping for a Raspberry Pi 40-pin header.
/// 
/// Pin layout (physical numbering):
/// Orientation: Hold the Raspberry Pi board so that the GPIO header (40 pins) is on the top-right corner of the board.
/// 
///  1  3.3V               2  5V
///  3  GPIO 2             4  5V
///  5  GPIO 3             6  GND
///  7  GPIO 4             8  GPIO 14 (TXD0)
///  9  GND               10  GPIO 15 (RXD0)
/// 11  GPIO 17           12  GPIO 18 (PWM0)
/// 13  GPIO 27           14  GND
/// 15  GPIO 22           16  GPIO 23
/// 17  3.3V              18  GPIO 24
/// 19  GPIO 10           20  GND
/// 21  GPIO 9            22  GPIO 25
/// 23  GPIO 11           24  GPIO 8
/// 25  GND               26  GPIO 7
/// 27  ID_SD             28  ID_SC
/// 29  GPIO 5            30  GND
/// 31  GPIO 6            32  GPIO 12 (PWM0)
/// 33  GPIO 13 (PWM1)     34  GND
/// 35  GPIO 19 (PWM1)     36  GPIO 16
/// 37  GPIO 26           38  GPIO 20
/// 39  GND               40  GPIO 21
/// 
/// Note: The BCM (Broadcom) numbering is used for GPIO functionality.
/// Pin Layout: The pins are numbered from top-left to bottom-right in two columns:  
///     The left column contains odd-numbered pins (1, 3, 5, etc.).
///     The right column contains even-numbered pins (2, 4, 6, etc.).
/// </summary>
public static  class RaspberryPiPinMap
{
    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_1 => null;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_2 => null;

    [PinFunction(PinFunctionFlags.SDA1 | PinFunctionFlags.GPIO)]
    public static  int PIN_3 => 2;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_4 => null;

    [PinFunction(PinFunctionFlags.SCL1 | PinFunctionFlags.GPIO)]
    public static  int PIN_5 => 3;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_6 => null;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_7 => 4;

    [PinFunction(PinFunctionFlags.UART_TXD0)]
    public static  int PIN_8 => 14;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_9 => null;

    [PinFunction(PinFunctionFlags.UART_RXD0)]
    public static  int PIN_10 => 15;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_11 => 17;

    [PinFunction(PinFunctionFlags.GPIO | PinFunctionFlags.PWM)]
    public static  int PIN_12 => 18;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_13 => 27;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_14 => null;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_15 => 22;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_16 => 23;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_17 => null;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_18 => 24;

    [PinFunction(PinFunctionFlags.SPI0_MOSI)]
    public static  int PIN_19 => 10;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_20 => null;

    [PinFunction(PinFunctionFlags.SPI0_MISO)]
    public static  int PIN_21 => 9;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_22 => 25;

    [PinFunction(PinFunctionFlags.SPI0_SCLK)]
    public static  int PIN_23 => 11;

    [PinFunction(PinFunctionFlags.SPI0_CE0)]
    public static  int PIN_24 => 8;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_25 => null;

    [PinFunction(PinFunctionFlags.SPI0_CE1)]
    public static  int PIN_26 => 7;

    [PinFunction(PinFunctionFlags.ID_SD)]
    public static  int PIN_27 => 0;

    [PinFunction(PinFunctionFlags.ID_SC)]
    public static  int PIN_28 => 1;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_29 => 5;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_30 => null;
    

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_31 => 6;

    [PinFunction(PinFunctionFlags.GPIO | PinFunctionFlags.PWM)]
    public static  int PIN_32 => 12;

    [PinFunction(PinFunctionFlags.GPIO | PinFunctionFlags.PWM)]
    public static  int PIN_33 => 13;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_34 => null;

    [PinFunction(PinFunctionFlags.GPIO | PinFunctionFlags.PWM)]
    public static  int PIN_35 => 19;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_36 => 16;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_37 => 26;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_38 => 20;

    [PinFunction(PinFunctionFlags.None)]
    public static  int? PIN_39 => null;

    [PinFunction(PinFunctionFlags.GPIO)]
    public static  int PIN_40 => 21;
}