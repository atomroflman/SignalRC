import { describe, expect, it } from "vitest";
import {
  PI_HEADER, channelsOnPin, freeChannelName, hasStandardHeader, isUsableGpio, pcaI2cAddress, pcaJumpers, piBoardVariant,
  pinProblems, readPinConfigs, withOption, writePinConfigs, DEFAULT_PIN_CONFIG, nearestPin, inputLevel,
} from "./pin-boards";
import { pinPosition } from "./raspberry-pi-board";
import { channelX } from "./pca9685-board";

describe("Raspberry Pi header", () => {
  it("has 40 pins in physical order with the BCM numbers of the onboard map", () => {
    expect(PI_HEADER.map(p => p.physical)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(PI_HEADER[10]).toMatchObject({ physical: 11, bcm: 17 });
    expect(PI_HEADER.filter(p => p.pwm).map(p => p.physical)).toEqual([12, 32, 33, 35]);
    expect(PI_HEADER.filter(isUsableGpio)).toHaveLength(26);
  });

  it("puts odd pins towards the board middle and pin 1 at the left", () => {
    const one = pinPosition("pi5", 1);
    const two = pinPosition("pi5", 2);
    const forty = pinPosition("pi5", 40);
    expect(one.x).toBeCloseTo(two.x);
    expect(one.y).toBeGreaterThan(two.y);
    expect(forty.x - one.x).toBeCloseTo(19 * 2.54);
  });

  it("picks the board from the device tree model", () => {
    expect(piBoardVariant("Raspberry Pi 5 Model B Rev 1.0")).toBe("pi5");
    expect(piBoardVariant("Raspberry Pi 4 Model B Rev 1.4")).toBe("pi4");
    expect(piBoardVariant("Raspberry Pi 3 Model B Plus Rev 1.3")).toBe("pi3");
    expect(piBoardVariant("Raspberry Pi 3 Model A Plus Rev 1.0")).toBe("pi3a");
    expect(piBoardVariant("Raspberry Pi Zero 2 W Rev 1.0")).toBe("zero");
    expect(piBoardVariant("Raspberry Pi 400 Rev 1.0")).toBe("pi400");
    expect(piBoardVariant("Raspberry Pi Compute Module 4 Rev 1.0")).toBe("generic");
    expect(piBoardVariant(null)).toBe("generic");
    expect(hasStandardHeader("Raspberry Pi Model B Rev 2")).toBe(false);
    expect(hasStandardHeader("Raspberry Pi Model B Plus Rev 1.2")).toBe(true);
  });
});

describe("pins option", () => {
  it("round-trips and writes only non-defaults, keeping other options", () => {
    const options = { driver: "Auto", Pins: [{ PIN: 11, mode: "input", pull: "up", activeLow: true, debounceMs: 20 }] };
    const pins = readPinConfigs(options);
    expect(pins).toEqual([{ ...DEFAULT_PIN_CONFIG, pin: 11, mode: "Input", pull: "Up", activeLow: true, debounceMs: 20 }]);
    const written = writePinConfigs(options, [...pins, { ...DEFAULT_PIN_CONFIG, pin: 7, pull: "Up" }]);
    expect(written).toEqual({
      driver: "Auto",
      pins: [{ pin: 7, mode: "Output" }, { pin: 11, mode: "Input", pull: "Up", activeLow: true, debounceMs: 20 }],
    });
    expect(writePinConfigs(written, [])).toEqual({ driver: "Auto" });
  });

  it("flags pins the onboard rejects", () => {
    expect(pinProblems({ ...DEFAULT_PIN_CONFIG, pin: 6 })).toHaveLength(1);
    expect(pinProblems({ ...DEFAULT_PIN_CONFIG, pin: 27 })).toHaveLength(1);
    expect(pinProblems({ ...DEFAULT_PIN_CONFIG, pin: 11, mode: "Pwm" })).toHaveLength(1);
    expect(pinProblems({ ...DEFAULT_PIN_CONFIG, pin: 12, mode: "Pwm" })).toEqual([]);
  });

  it("replaces options case-insensitively", () => {
    expect(withOption({ BoardAddress: 1, i2cBus: 1 }, "boardAddress", 3)).toEqual({ i2cBus: 1, boardAddress: 3 });
  });
});

describe("channels and names", () => {
  it("finds the channels on a pin, default manager included", () => {
    const refs = [
      { kind: "control" as const, name: "a", type: "GpioOutput", pinManager: null, address: 11 },
      { kind: "telemetry" as const, name: "b", type: "x", pinManager: "default", address: 11 },
      { kind: "telemetry" as const, name: "c", type: "x", pinManager: "pca", address: 11 },
    ];
    expect(channelsOnPin(refs, "default", 11).map(c => c.name)).toEqual(["a", "b"]);
  });

  it("makes free channel names", () => {
    expect(freeChannelName("endstop front", ["endstop_front"])).toBe("endstop_front2");
    expect(freeChannelName("gpio11", [])).toBe("gpio11");
  });
});

describe("PCA9685 board", () => {
  it("maps jumpers to the I2C address", () => {
    expect(pcaJumpers(5)).toEqual([true, false, true, false, false, false]);
    expect(pcaI2cAddress(0)).toBe("0x40");
    expect(pcaI2cAddress(5)).toBe("0x45");
  });

  it("leaves a gap between the groups of four", () => {
    expect(channelX(1) - channelX(0)).toBeCloseTo(2.54);
    expect(channelX(4) - channelX(3)).toBeCloseTo(5.08);
  });
});

describe("pull resistor schematic helpers", () => {
  it("finds the nearest GND and 3.3 V pin, same row first", () => {
    expect(nearestPin(11, "gnd")?.physical).toBe(9);
    expect(nearestPin(11, "3v3")?.physical).toBe(17);
    expect(nearestPin(40, "gnd")?.physical).toBe(39);
  });

  it("gives the level of a switched input", () => {
    expect(inputLevel("Up", false)).toBe("HIGH");
    expect(inputLevel("Up", true)).toBe("LOW");
    expect(inputLevel("Down", true)).toBe("HIGH");
    expect(inputLevel("None", true)).toBe("LOW");
  });
});
