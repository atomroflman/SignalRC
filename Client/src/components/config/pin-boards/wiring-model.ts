// The wiring of a vehicle derived from its channel map: which device hangs on
// which Raspberry Pi pin or PCA9685 channel, how the PCA9685 boards sit on
// the I²C bus, what is connected some other way (CAN, USB/serial) and what
// is missing or conflicting. Pure data; wiring-diagram.tsx draws it.

import {
  GPIO_READER, PCA_BASE_ADDRESS, PI_HEADER, PWM_READER, isUsableGpio, nearestPin, optionValue, pcaI2cAddress, piBoardVariant,
  readPcaChannels, readPinConfigs, type ConnectedDevice, type GpioPinConfig, type GpioPinMode, type GpioPull, type HeaderPin, type PiBoardVariant,
} from "./pin-boards";

export interface WiringManager { name: string; type: string; options: unknown }

export interface WiringChannel {
  kind: "control" | "telemetry";
  name: string;
  type: string;
  pinManager?: string | null;
  address?: number | null;
  displayName?: string | null;
  options?: unknown;
}

export type DeviceKind = "servo" | "esc" | "led" | "relay" | "buzzer" | "button" | "output" | "input";

export type Endpoint =
  | { board: "pi"; pin: number }
  | { board: "pca"; manager: string; channel: number };

export interface WiringReader { name: string; type: "gpio" | "pwm"; report: string }

export interface WiringDevice {
  id: string;
  kind: DeviceKind;
  /** Device set in the pin manager config; Auto = guessed from the channels. */
  device: ConnectedDevice;
  /** Pin manager whose options hold the pin/channel config (where the device is saved). */
  manager: string;
  /** Display name, channel name or pin label. */
  title: string;
  endpoint: Endpoint;
  /** Control channels driving it. */
  controls: string[];
  /** Telemetry channels reading it back. */
  readers: WiringReader[];
  /** Pi pins: the pin config (defaults when the pin has none). */
  pin?: GpioPinConfig;
  /** Driven by PWM (brightness, servo pulse) rather than on/off. */
  pwm: boolean;
  /** Pi pins: GND, 3.3 V and 5 V pins nearest to the signal pin, for the wires. */
  gnd?: number;
  v33?: number;
  v5?: number;
  notes: string[];
}

export interface WiringPca {
  name: string;
  bus: number;
  boardAddress: number;
  i2cAddress: string;
  devices: WiringDevice[];
}

export type ExternalKind = "can" | "lidar" | "bms" | "other";

export interface WiringExternal { name: string; kind: ExternalKind; type: string; detail: string; channels: string[] }

export interface BomItem { item: string; count: number; note?: string }

export interface WiringDiagram {
  variant: PiBoardVariant;
  boardModel: string | null;
  piDevices: WiringDevice[];
  pcas: WiringPca[];
  externals: WiringExternal[];
  /** Channels with no hardware (LoggingOnly, CustomBash …). */
  software: string[];
  warnings: string[];
  bom: BomItem[];
}

// ---------------------------------------------------------------------------

const lc = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export const isPiManagerType = (type: string) => lc(type) === "raspberrypigpiomanager";
export const isPcaManagerType = (type: string) => lc(type) === "pca9685pwmextension";

const SERVO_TYPES = new Set(["steering", "servoonoff", "onoffservo"]);
const ESC_TYPES = new Set(["throttle"]);
const LIGHT_TYPES = new Set(["pwmlight", "pwmblinker", "rotarylight"]);
const SOFTWARE_TYPES = new Set(["loggingonly", "loopbacktotelemetry", "custombash"]);

/** What a GPIO output most likely drives, from its names: relay, buzzer or (default) LED. */
export function guessOutputKind(...names: (string | null | undefined)[]): DeviceKind {
  const text = names.map(lc).join(" ");
  if (/relay|relais|pump|pumpe|fan|lüfter|luefter|motor|valve|ventil|winch|winde|mosfet/.test(text)) return "relay";
  if (/buzz|horn|hupe|beep|piep|summer|siren|sirene/.test(text)) return "buzzer";
  return "led";
}

/** The device a control type stands for; undefined for software-only types and unknown types. */
export function controlDeviceKind(type: string, name: string, displayName?: string | null): DeviceKind | "software" | undefined {
  const t = lc(type);
  if (SERVO_TYPES.has(t)) return "servo";
  if (ESC_TYPES.has(t)) return "esc";
  if (LIGHT_TYPES.has(t)) return "led";
  if (t === "gpiooutput") return guessOutputKind(name, displayName);
  if (SOFTWARE_TYPES.has(t) || t.startsWith("track")) return "software";
  return undefined;
}

/** The part a configured device stands for; undefined for Auto. */
export function connectedDeviceKind(device: ConnectedDevice): DeviceKind | undefined {
  switch (device) {
    case "Led": return "led";
    case "Relay": return "relay";
    case "Buzzer": return "buzzer";
    case "Servo": return "servo";
    case "Esc": return "esc";
    case "Button": return "button";
    case "Sensor": return "input";
    case "Other": return "output";
    default: return undefined;
  }
}

const KIND_RANK: Record<DeviceKind, number> = { esc: 7, servo: 6, relay: 5, buzzer: 4, led: 3, output: 2, button: 1, input: 0 };

const readerOf = (c: WiringChannel): WiringReader | undefined => {
  if (c.type === GPIO_READER) return { name: c.name, type: "gpio", report: String(optionValue(c.options, "report") ?? "State") };
  if (c.type === PWM_READER) return { name: c.name, type: "pwm", report: String(optionValue(c.options, "report") ?? "Percent") };
  return undefined;
};

function externalOf(m: WiringManager, channels: WiringChannel[]): WiringExternal {
  const t = lc(m.type);
  const used = channels.filter(c => (c.pinManager || "default") === m.name).map(c => c.name);
  if (t === "cantrackdrivemanager") {
    const iface = String(optionValue(m.options, "interface") ?? "can0");
    return { name: m.name, kind: "can", type: m.type, detail: `SocketCAN ${iface} (CAN HAT on SPI or USB-CAN adapter)`, channels: used };
  }
  if (t === "lidarmanager") {
    const port = String(optionValue(m.options, "port") ?? "/dev/lidar");
    return { name: m.name, kind: "lidar", type: m.type, detail: `Serial ${port} @ ${optionValue(m.options, "baudRate") ?? 115200} Bd (USB adapter)`, channels: used };
  }
  return { name: m.name, kind: "other", type: m.type, detail: m.type, channels: used };
}

const pinTitle = (pin: HeaderPin) => `Pin ${pin.physical} · ${pin.label}`;

export function buildWiring(managers: WiringManager[], channels: WiringChannel[], boardModel: string | null | undefined): WiringDiagram {
  const warnings: string[] = [];
  const software: string[] = [];
  const byName = new Map(managers.map(m => [m.name, m]));
  // "default" is a bare RaspberryPiGpioManager unless configured otherwise.
  if (!byName.has("default")) byName.set("default", { name: "default", type: "RaspberryPiGpioManager", options: {} });

  const piManagers = [...byName.values()].filter(m => isPiManagerType(m.type));
  const pinConfigs = new Map<number, GpioPinConfig>();
  const pinOwner = new Map<number, string>();
  for (const m of piManagers) for (const c of readPinConfigs(m.options)) {
    if (pinConfigs.has(c.pin)) warnings.push(`Pin ${c.pin} is configured by more than one GPIO pin manager.`);
    else { pinConfigs.set(c.pin, c); pinOwner.set(c.pin, m.name); }
  }

  // Group the channels by endpoint.
  type Group = { endpoint: Endpoint; manager: string; controls: WiringChannel[]; readers: WiringReader[]; kinds: DeviceKind[] };
  const groups = new Map<string, Group>();
  const keyOf = (e: Endpoint) => e.board === "pi" ? `pi:${e.pin}` : `pca:${e.manager}:${e.channel}`;
  const group = (e: Endpoint, manager: string) => {
    const k = keyOf(e);
    let g = groups.get(k);
    if (!g) { g = { endpoint: e, manager, controls: [], readers: [], kinds: [] }; groups.set(k, g); }
    return g;
  };
  const externals = new Map<string, WiringExternal>();

  for (const c of channels) {
    const managerName = c.pinManager || "default";
    const m = byName.get(managerName);
    const reader = c.kind === "telemetry" ? readerOf(c) : undefined;
    const kind = c.kind === "control" ? controlDeviceKind(c.type, c.name, c.displayName) : undefined;
    if (c.kind === "control" && kind === "software") {
      if (!lc(c.type).startsWith("track")) { software.push(c.name); continue; }
    }
    if (c.kind === "telemetry" && !reader) continue; // CPU temperature, BMS … are not on a pin
    if (!m) { warnings.push(`${c.name}: pin manager "${managerName}" does not exist.`); continue; }

    if (isPiManagerType(m.type)) {
      if (kind === "software") continue;
      if (c.address == null) { warnings.push(`${c.name}: no pin (address) set.`); continue; }
      const pin = PI_HEADER[c.address - 1];
      if (!pin) { warnings.push(`${c.name}: pin ${c.address} is not on the 40-pin header (addresses are physical pin numbers 1–40).`); continue; }
      if (!isUsableGpio(pin)) { warnings.push(`${c.name}: pin ${c.address} (${pin.label}) is not a GPIO.`); continue; }
      const g = group({ board: "pi", pin: c.address }, pinOwner.get(c.address) ?? managerName);
      if (reader) g.readers.push(reader); else { g.controls.push(c); g.kinds.push(kind ?? "output"); }
    } else if (isPcaManagerType(m.type)) {
      if (kind === "software") continue;
      if (c.address == null || c.address < 0 || c.address > 15) { warnings.push(`${c.name}: PCA9685 channel ${c.address ?? "-"} is not 0–15.`); continue; }
      const g = group({ board: "pca", manager: m.name, channel: c.address }, m.name);
      if (reader) {
        if (reader.type === "gpio") warnings.push(`${c.name}: GpioPinReader on a PCA9685 channel - the PCA only has PWM outputs, use PwmOutputReader.`);
        g.readers.push(reader);
      } else { g.controls.push(c); g.kinds.push(kind === "relay" || kind === "buzzer" ? kind : kind ?? "output"); }
    } else {
      if (!externals.has(m.name)) externals.set(m.name, externalOf(m, channels));
    }
  }
  for (const m of byName.values())
    if (!isPiManagerType(m.type) && !isPcaManagerType(m.type) && !externals.has(m.name)) externals.set(m.name, externalOf(m, channels));

  // Configured pins without any channel still get drawn.
  for (const cfg of pinConfigs.values()) {
    const pin = PI_HEADER[cfg.pin - 1];
    if (pin && isUsableGpio(pin)) group({ board: "pi", pin: cfg.pin }, pinOwner.get(cfg.pin)!);
  }
  const pcaConfigs = new Map<string, ReturnType<typeof readPcaChannels>[number]>();
  for (const m of byName.values()) if (isPcaManagerType(m.type))
    for (const c of readPcaChannels(m.options)) if (c.channel >= 0 && c.channel <= 15) {
      pcaConfigs.set(`${m.name}:${c.channel}`, c);
      group({ board: "pca", manager: m.name, channel: c.channel }, m.name);
    }

  const pcaNames = [...byName.values()].filter(m => isPcaManagerType(m.type)).map(m => m.name);
  const piDevices: WiringDevice[] = [];
  const pcaDevices = new Map<string, WiringDevice[]>(pcaNames.map(n => [n, []]));

  for (const g of groups.values()) {
    const controlNames = g.controls.map(c => c.name);
    const title = g.controls.map(c => c.displayName || c.name)[0];
    const strongest = [...g.kinds].sort((a, b) => KIND_RANK[b] - KIND_RANK[a])[0];
    const notes: string[] = [];
    if (g.controls.length > 1) notes.push(`${g.controls.length} control channels share this output: ${controlNames.join(", ")}.`);

    if (g.endpoint.board === "pi") {
      const physical = g.endpoint.pin;
      const header = PI_HEADER[physical - 1];
      const cfg = pinConfigs.get(physical);
      const mode: GpioPinMode = cfg?.mode ?? (g.controls.length > 0 ? (strongest === "servo" || strongest === "esc" ? "Pwm" : "Output") : "Input");
      const pin: GpioPinConfig = cfg ?? { pin: physical, mode, pull: "None", activeLow: false, debounceMs: 0, initialState: false, label: "", device: "Auto" };
      let kind: DeviceKind = strongest ?? (mode === "Input" ? "button" : mode === "Pwm" ? "led" : "output");
      if (!strongest && mode === "Output" && cfg?.label) {
        // A configured output without channel: trust the label only when it says what it is.
        const guess = guessOutputKind(cfg.label);
        kind = guess !== "led" || /led|light|licht|lamp/i.test(cfg.label) ? guess : "output";
      }
      kind = connectedDeviceKind(pin.device) ?? kind;
      if (mode === "Input" && g.controls.length > 0) warnings.push(`Pin ${physical}: configured as input but driven by ${controlNames.join(", ")}.`);
      if ((kind === "servo" || kind === "esc") && !header.pwm)
        warnings.push(`${title ?? pinTitle(header)}: a servo signal needs hardware PWM - use pin 12, 32, 33 or 35 or a PCA9685 channel.`);
      if ((kind === "servo" || kind === "esc") && mode !== "Pwm")
        warnings.push(`${title ?? pinTitle(header)}: pin ${physical} should be in mode Pwm for a servo signal.`);
      if (g.controls.length === 0 && g.readers.length === 0) notes.push("Configured, but no channel uses this pin yet.");
      if (kind === "led") notes.push("LED with series resistor (330 Ω) to GND; a GPIO delivers max. ~16 mA.");
      if (kind === "relay") notes.push("Use a relay/MOSFET module (VCC 5 V, IN on the GPIO); never a bare coil on a GPIO.");
      if (kind === "buzzer") notes.push("Active 3.3 V buzzer, or through a transistor for louder ones.");
      if (kind === "servo" || kind === "esc") notes.push("Servo power from a separate 5–6 V BEC, its GND joined with the Pi's GND.");
      if (kind === "button" && pin.pull === "None") notes.push("No internal pull: add 10 kΩ to 3.3 V.");
      piDevices.push({
        id: keyOf(g.endpoint), kind, device: pin.device, manager: g.manager, title: title ?? (cfg?.label || header.label), endpoint: g.endpoint,
        controls: controlNames, readers: g.readers, pin, pwm: mode === "Pwm",
        gnd: nearestPin(physical, "gnd")?.physical, v33: nearestPin(physical, "3v3")?.physical, v5: nearestPin(physical, "5v")?.physical, notes,
      });
    } else {
      const cfg = pcaConfigs.get(`${g.endpoint.manager}:${g.endpoint.channel}`);
      const kind: DeviceKind = connectedDeviceKind(cfg?.device ?? "Auto") ?? strongest ?? "output";
      if (g.controls.length === 0) notes.push(g.readers.length > 0 ? "Only read back, no control channel drives this channel." : "Configured, but no channel uses this output yet.");
      if (kind === "led") notes.push("LED with 220 Ω series resistor between PWM (+) and GND (−); the PCA sinks/sources max. 25 mA.");
      if (kind === "relay") notes.push("Relay/MOSFET module: IN on PWM, VCC on V+, GND on GND.");
      if (kind === "esc") notes.push("If the ESC has a BEC, its red wire feeds V+ for all servos - use only one BEC.");
      pcaDevices.get(g.endpoint.manager)?.push({
        id: keyOf(g.endpoint), kind, device: cfg?.device ?? "Auto", manager: g.manager,
        title: title ?? (cfg?.label || `Channel ${g.endpoint.channel}`), endpoint: g.endpoint,
        controls: controlNames, readers: g.readers, pwm: true, notes,
      });
    }
  }
  piDevices.sort((a, b) => (a.endpoint as { pin: number }).pin - (b.endpoint as { pin: number }).pin);

  const pcas: WiringPca[] = pcaNames.map(name => {
    const m = byName.get(name)!;
    const boardAddress = Number(optionValue(m.options, "boardAddress") ?? 0) & 0x3f;
    const bus = Number(optionValue(m.options, "i2cBus") ?? 1);
    const devices = (pcaDevices.get(name) ?? []).sort((a, b) => (a.endpoint as { channel: number }).channel - (b.endpoint as { channel: number }).channel);
    return { name, bus, boardAddress, i2cAddress: pcaI2cAddress(boardAddress), devices };
  });

  // Bus checks.
  const seen = new Map<string, string>();
  for (const p of pcas) {
    const k = `${p.bus}:${p.boardAddress}`;
    if (seen.has(k)) warnings.push(`${p.name} and ${seen.get(k)} both use I²C address ${p.i2cAddress} on bus ${p.bus} - set different address jumpers.`);
    else seen.set(k, p.name);
    if (p.bus !== 1) warnings.push(`${p.name} is on I²C bus ${p.bus}; the diagram shows the header bus 1 (pins 3/5). Other buses need a dtoverlay.`);
    if (p.boardAddress + PCA_BASE_ADDRESS === 0x70) warnings.push(`${p.name}: 0x70 is the PCA9685 "all call" address - avoid jumpers A4–A5 all set.`);
  }
  if (pcas.some(p => p.bus === 1))
    for (const pin of [3, 5]) {
      const d = piDevices.find(x => (x.endpoint as { pin: number }).pin === pin);
      if (d) warnings.push(`Pin ${pin} (${pin === 3 ? "SDA" : "SCL"}) is used by ${d.title} but the PCA9685 needs it for I²C.`);
    }

  return {
    variant: piBoardVariant(boardModel), boardModel: boardModel ?? null,
    piDevices, pcas, externals: [...externals.values()], software, warnings, bom: billOfMaterials(piDevices, pcas, [...externals.values()]),
  };
}

const DEVICE_PART: Record<DeviceKind, string> = {
  servo: "Servo", esc: "ESC (+ motor)", led: "LED", relay: "Relay / MOSFET module", buzzer: "Buzzer",
  button: "Push button / switch", output: "Load on a digital output", input: "Digital sensor / switch",
};

export function billOfMaterials(piDevices: WiringDevice[], pcas: WiringPca[], externals: WiringExternal[]): BomItem[] {
  const counts = new Map<string, BomItem>();
  const add = (item: string, n = 1, note?: string) => {
    const e = counts.get(item);
    if (e) e.count += n; else counts.set(item, { item, count: n, note });
  };
  add("Raspberry Pi", 1);
  for (const d of piDevices) {
    add(DEVICE_PART[d.kind]);
    if (d.kind === "led") add("Resistor 330 Ω", 1, "LED series resistor on a Pi pin");
    if (d.kind === "button" && d.pin?.pull === "None") add("Resistor 10 kΩ", 1, "external pull-up");
  }
  if (piDevices.some(d => d.kind === "servo" || d.kind === "esc")) add("BEC 5–6 V", 1, "servo power for Pi PWM pins");
  for (const p of pcas) {
    add("PCA9685 16-channel PWM board", 1);
    for (const d of p.devices) {
      add(DEVICE_PART[d.kind]);
      if (d.kind === "led") add("Resistor 220 Ω", 1, "LED series resistor on a PCA channel");
    }
  }
  if (pcas.length > 0) {
    add("Jumper wire female–female", 4 * pcas.length, "I²C: 3.3 V, SDA, SCL, GND");
    if (pcas.some(p => p.devices.some(d => d.kind === "servo" || d.kind === "led" || d.kind === "relay")) && !pcas.some(p => p.devices.some(d => d.kind === "esc")))
      add("BEC 5–6 V", 1, "V+ for the PCA9685 servo rail");
  }
  for (const e of externals) {
    if (e.kind === "can") add("CAN interface (HAT or USB)", 1, e.detail);
    if (e.kind === "lidar") add("LiDAR + USB-serial adapter", 1, e.detail);
  }
  return [...counts.values()];
}

/** Human readable wire list: from → to, for printing and checking. */
export interface WireRow { from: string; to: string; signal: string; note?: string }

const piPinName = (n: number | undefined) => {
  const p = n ? PI_HEADER[n - 1] : undefined;
  return p ? `Pi pin ${p.physical} (${p.label}${p.alt ? `/${p.alt}` : ""})` : "Pi";
};

export function wireList(d: WiringDiagram): WireRow[] {
  const rows: WireRow[] = [];
  for (const dev of d.piDevices) {
    const pin = (dev.endpoint as { pin: number }).pin;
    const sig = piPinName(pin);
    switch (dev.kind) {
      case "led":
        rows.push({ from: sig, to: `${dev.title}: 330 Ω → LED anode (+, long leg)`, signal: "signal" });
        rows.push({ from: piPinName(dev.gnd), to: `${dev.title}: LED cathode (−)`, signal: "GND" });
        break;
      case "relay":
        rows.push({ from: sig, to: `${dev.title}: IN`, signal: "signal" });
        rows.push({ from: piPinName(dev.v5), to: `${dev.title}: VCC`, signal: "5 V" });
        rows.push({ from: piPinName(dev.gnd), to: `${dev.title}: GND`, signal: "GND" });
        break;
      case "servo": case "esc":
        rows.push({ from: sig, to: `${dev.title}: signal (orange/white)`, signal: "PWM" });
        rows.push({ from: "BEC +5–6 V", to: `${dev.title}: + (red)`, signal: "V+" });
        rows.push({ from: piPinName(dev.gnd), to: `${dev.title}: − (brown/black) and BEC −`, signal: "GND" });
        break;
      case "button": case "input": {
        const pull = dev.pin?.pull ?? "None";
        if (pull === "Down") rows.push({ from: piPinName(dev.v33), to: `${dev.title}: contact 2`, signal: "3.3 V", note: "internal pull-down" });
        else rows.push({ from: piPinName(dev.gnd), to: `${dev.title}: contact 2`, signal: "GND", note: pull === "Up" ? "internal pull-up" : undefined });
        rows.push({ from: sig, to: `${dev.title}: contact 1`, signal: "input" });
        if (pull === "None") rows.push({ from: piPinName(dev.v33), to: `${dev.title}: 10 kΩ to contact 1`, signal: "3.3 V", note: "external pull-up" });
        break;
      }
      default:
        rows.push({ from: sig, to: `${dev.title}: +`, signal: "signal" });
        rows.push({ from: piPinName(dev.gnd), to: `${dev.title}: −`, signal: "GND" });
    }
  }
  d.pcas.forEach((p, i) => {
    const prev = i === 0 || p.bus !== d.pcas[i - 1].bus ? undefined : d.pcas[i - 1];
    if (!prev) {
      rows.push({ from: piPinName(1), to: `${p.name}: VCC`, signal: "3.3 V" });
      rows.push({ from: piPinName(3), to: `${p.name}: SDA`, signal: "SDA" });
      rows.push({ from: piPinName(5), to: `${p.name}: SCL`, signal: "SCL" });
      rows.push({ from: piPinName(6), to: `${p.name}: GND`, signal: "GND" });
    } else {
      for (const s of ["VCC", "SDA", "SCL", "GND"]) rows.push({ from: `${prev.name}: ${s} (right header)`, to: `${p.name}: ${s} (left header)`, signal: s, note: "chained" });
    }
    if (p.devices.length > 0) rows.push({ from: "BEC / ESC-BEC + and −", to: `${p.name}: V+ / GND terminal`, signal: "V+", note: "servo power, not from the Pi" });
    for (const dev of p.devices) {
      const ch = (dev.endpoint as { channel: number }).channel;
      rows.push({ from: `${p.name} ch ${ch} (PWM / V+ / GND)`, to: `${dev.title}: ${dev.kind === "led" ? "220 Ω → anode, cathode → GND" : "3-pin plug, signal towards the PWM row"}`, signal: "PWM" });
    }
  });
  return rows;
}
