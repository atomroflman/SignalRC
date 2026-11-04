import { describe, expect, it } from "vitest";
import { buildWiring, connectedDeviceKind, controlDeviceKind, guessOutputKind, wireList, type WiringChannel, type WiringManager } from "./wiring-model";
import { GPIO_READER, PWM_READER, readPcaChannels, readPinConfigs, writePcaChannels, writePinConfigs } from "./pin-boards";
import { layoutWiring, pulseMs } from "./wiring-diagram";
import { ledColor } from "./device-art";

const pca = (name: string, boardAddress = 0, i2cBus = 1): WiringManager => ({ name, type: "Pca9685PwmExtension", options: { boardAddress, i2cBus } });
const control = (name: string, type: string, pinManager: string, address: number | null): WiringChannel => ({ kind: "control", name, type, pinManager, address });
const reader = (name: string, type: string, pinManager: string, address: number, options?: unknown): WiringChannel => ({ kind: "telemetry", name, type, pinManager, address, options });

describe("device kinds", () => {
  it("maps control types to parts", () => {
    expect(controlDeviceKind("Steering", "s")).toBe("servo");
    expect(controlDeviceKind("Throttle", "t")).toBe("esc");
    expect(controlDeviceKind("PwmBlinker", "b")).toBe("led");
    expect(controlDeviceKind("LoggingOnly", "l")).toBe("software");
    expect(controlDeviceKind("TrackLeft", "l")).toBe("software");
    expect(controlDeviceKind("Whatever", "x")).toBeUndefined();
  });

  it("guesses what a GPIO output drives from its names", () => {
    expect(guessOutputKind("pumpRelay")).toBe("relay");
    expect(guessOutputKind("x", "Hupe")).toBe("buzzer");
    expect(guessOutputKind("rearLight")).toBe("led");
    expect(controlDeviceKind("GpioOutput", "winch")).toBe("relay");
  });

  it("colours LEDs by name", () => {
    expect(ledColor("blinkerLeft")).toBe("#f59e0b");
    expect(ledColor("Scheinwerfer")).toBe("#f4f4f5");
    expect(ledColor("rear")).toBe("#ef4444");
  });
});

describe("buildWiring", () => {
  it("puts parts on Pi pins and PCA channels and merges readers into them", () => {
    const d = buildWiring(
      [pca("pca"), { name: "default", type: "RaspberryPiGpioManager", options: { pins: [{ pin: 11, mode: "Input", pull: "Up" }] } }],
      [
        control("steering", "Steering", "pca", 0),
        reader("steeringPos", PWM_READER, "pca", 0, { report: "PulseWidthMs" }),
        control("light", "GpioOutput", "default", 13),
        reader("endstop", GPIO_READER, "default", 11),
        control("log", "LoggingOnly", "default", 0),
      ],
      "Raspberry Pi 5 Model B Rev 1.0");
    expect(d.variant).toBe("pi5");
    expect(d.software).toEqual(["log"]);
    expect(d.piDevices.map(x => [x.endpoint, x.kind])).toEqual([[{ board: "pi", pin: 11 }, "button"], [{ board: "pi", pin: 13 }, "led"]]);
    expect(d.piDevices[0]).toMatchObject({ gnd: 9, v33: 17, readers: [{ name: "endstop", type: "gpio" }] });
    expect(d.pcas[0]).toMatchObject({ name: "pca", i2cAddress: "0x40" });
    expect(d.pcas[0].devices[0]).toMatchObject({ kind: "servo", controls: ["steering"], readers: [{ name: "steeringPos", report: "PulseWidthMs" }] });
    expect(d.warnings).toEqual([]);
  });

  it("uses the implicit default manager and draws configured pins without a channel", () => {
    const d = buildWiring([], [], null);
    expect(d.piDevices).toEqual([]);
    const withPin = buildWiring([{ name: "default", type: "RaspberryPiGpioManager", options: { pins: [{ pin: 16, mode: "Input" }] } }], [], null);
    expect(withPin.piDevices[0]).toMatchObject({ kind: "button", title: "GPIO 23" });
    expect(withPin.piDevices[0].notes.join(" ")).toMatch(/no channel/);
  });

  it("warns about wiring problems", () => {
    const d = buildWiring([pca("a", 0), pca("b", 0), pca("c", 1, 3)], [
      control("servo", "Steering", "default", 11),
      control("onSda", "GpioOutput", "default", 3),
      control("missing", "Steering", "nope", 1),
      control("power", "GpioOutput", "default", 2),
      control("noAddress", "GpioOutput", "default", null),
      control("ch20", "Steering", "a", 20),
    ], null);
    const text = d.warnings.join("\n");
    expect(text).toMatch(/needs hardware PWM/);
    expect(text).toMatch(/both use I²C address 0x40/);
    expect(text).toMatch(/bus 3/);
    expect(text).toMatch(/Pin 3 \(SDA\) is used by onSda/);
    expect(text).toMatch(/"nope" does not exist/);
    expect(text).toMatch(/pin 2 \(5V\) is not a GPIO/);
    expect(text).toMatch(/noAddress: no pin/);
    expect(text).toMatch(/channel 20 is not 0–15/);
  });

  it("lists CAN and serial managers as external devices", () => {
    const d = buildWiring([{ name: "can", type: "CanTrackDriveManager", options: { interface: "can1" } }], [control("left", "TrackLeft", "can", 0)], null);
    expect(d.externals).toEqual([expect.objectContaining({ name: "can", kind: "can", channels: ["left"] })]);
    expect(d.externals[0].detail).toMatch(/can1/);
    expect(d.piDevices).toEqual([]);
  });

  it("counts parts and lists wires, chaining PCA boards on one bus", () => {
    const d = buildWiring([pca("a", 0), pca("b", 1)], [
      control("s1", "Steering", "a", 0), control("s2", "Steering", "b", 3), control("led", "GpioOutput", "default", 13),
    ], null);
    const bom = Object.fromEntries(d.bom.map(b => [b.item, b.count]));
    expect(bom).toMatchObject({ Servo: 2, LED: 1, "Resistor 330 Ω": 1, "PCA9685 16-channel PWM board": 2, "BEC 5–6 V": 1 });
    const wires = wireList(d);
    expect(wires.filter(w => w.to.startsWith("a: ")).map(w => w.from)).toEqual(expect.arrayContaining(["Pi pin 3 (GPIO 2/SDA1)", "Pi pin 5 (GPIO 3/SCL1)"]));
    expect(wires.some(w => w.from.startsWith("a: SDA") && w.to.startsWith("b: SDA") && w.note === "chained")).toBe(true);
  });
});

describe("layout", () => {
  it("wires every terminal and keeps parts inside the sheet", () => {
    const d = buildWiring([pca("a")], [
      control("s", "Steering", "a", 0), control("pan", "Steering", "default", 12), control("relay", "GpioOutput", "default", 15),
    ], null);
    const l = layoutWiring(d, "pi4");
    expect(l.piSupply).toBeDefined();
    const ids = l.wires.map(w => w.id);
    expect(ids).toEqual(expect.arrayContaining(["pi:12:sig", "pi:12:gnd", "pi:12:vplus", "pi:15:vcc", "a:i2c:SDA", "a:vplus", "pca:a:0:sig", "pca:a:0:plus"]));
    for (const c of [...l.piCards, ...l.pcas.flatMap(p => p.cards)]) {
      expect(c.at.x).toBeGreaterThanOrEqual(l.minX);
      expect(c.at.x).toBeLessThanOrEqual(l.minX + l.width);
    }
  });

  it("converts PwmOutputReader reports to a pulse width", () => {
    expect(pulseMs({ name: "x", type: "pwm", report: "Percent" }, 7.5)).toBeCloseTo(1.5);
    expect(pulseMs({ name: "x", type: "pwm", report: "PulseWidthUs" }, 2000)).toBe(2);
    expect(pulseMs({ name: "x", type: "pwm", report: "Counts" }, 307)).toBeCloseTo(1.5, 1);
  });
});

describe("configured devices", () => {
  it("round-trips device in pin configs and PCA channel configs", () => {
    const pins = readPinConfigs({ pins: [{ pin: 13, mode: "Output", device: "relay" }, { pin: 15, mode: "Output" }] });
    expect(pins.map(p => p.device)).toEqual(["Relay", "Auto"]);
    expect(writePinConfigs({}, pins)).toEqual({ pins: [{ pin: 13, mode: "Output", device: "Relay" }, { pin: 15, mode: "Output" }] });
    const chans = readPcaChannels({ Channels: [{ channel: 4, device: "Led", label: "Blinker" }, { channel: 2 }] });
    expect(chans).toEqual([{ channel: 4, device: "Led", label: "Blinker" }, { channel: 2, device: "Auto", label: "" }]);
    expect(writePcaChannels({ boardAddress: 1, Channels: [] }, chans)).toEqual({ boardAddress: 1, channels: [{ channel: 4, device: "Led", label: "Blinker" }] });
    expect(writePcaChannels({ channels: [{ channel: 1 }] }, [])).toEqual({});
  });

  it("lets the configured device win over the guess and keeps where it is saved", () => {
    const d = buildWiring([
      { name: "gpio", type: "RaspberryPiGpioManager", options: { pins: [{ pin: 13, mode: "Output", device: "Relay" }] } },
      { name: "pca", type: "Pca9685PwmExtension", options: { channels: [{ channel: 0, device: "Esc" }, { channel: 7, device: "Led", label: "Blinker links" }] } },
    ], [
      control("light", "GpioOutput", "gpio", 13),
      control("drive", "Steering", "pca", 0),
    ], null);
    expect(d.piDevices[0]).toMatchObject({ kind: "relay", device: "Relay", manager: "gpio" });
    expect(d.pcas[0].devices.map(x => [x.endpoint, x.kind, x.title])).toEqual([
      [{ board: "pca", manager: "pca", channel: 0 }, "esc", "drive"],
      [{ board: "pca", manager: "pca", channel: 7 }, "led", "Blinker links"],
    ]);
    expect(connectedDeviceKind("Sensor")).toBe("input");
    expect(connectedDeviceKind("Auto")).toBeUndefined();
  });
});
