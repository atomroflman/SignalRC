// Data behind the pin manager board editors: the Raspberry Pi 40-pin header
// (same table as Onboard/Hardware/RaspiPinMap.cs - keep both in sync), board
// variants by the model the onboard reports (/proc/device-tree/model), the
// "pins" option of RaspberryPiGpioManager and which channels use a pin.

export type PinKind = "3v3" | "5v" | "gnd" | "gpio" | "i2c" | "uart" | "spi" | "id";

export interface HeaderPin {
  physical: number;
  bcm: number | null;
  kind: PinKind;
  label: string;
  /** Alternate function, e.g. "SDA1", "PWM0". */
  alt?: string;
  pwm?: boolean;
}

const p = (physical: number, bcm: number | null, kind: PinKind, label: string, alt?: string, pwm?: boolean): HeaderPin =>
  ({ physical, bcm, kind, label, alt, pwm });

export const PI_HEADER: HeaderPin[] = [
  p(1, null, "3v3", "3.3V"), p(2, null, "5v", "5V"),
  p(3, 2, "i2c", "GPIO 2", "SDA1"), p(4, null, "5v", "5V"),
  p(5, 3, "i2c", "GPIO 3", "SCL1"), p(6, null, "gnd", "GND"),
  p(7, 4, "gpio", "GPIO 4", "GPCLK0"), p(8, 14, "uart", "GPIO 14", "TXD0"),
  p(9, null, "gnd", "GND"), p(10, 15, "uart", "GPIO 15", "RXD0"),
  p(11, 17, "gpio", "GPIO 17"), p(12, 18, "gpio", "GPIO 18", "PWM0", true),
  p(13, 27, "gpio", "GPIO 27"), p(14, null, "gnd", "GND"),
  p(15, 22, "gpio", "GPIO 22"), p(16, 23, "gpio", "GPIO 23"),
  p(17, null, "3v3", "3.3V"), p(18, 24, "gpio", "GPIO 24"),
  p(19, 10, "spi", "GPIO 10", "MOSI"), p(20, null, "gnd", "GND"),
  p(21, 9, "spi", "GPIO 9", "MISO"), p(22, 25, "gpio", "GPIO 25"),
  p(23, 11, "spi", "GPIO 11", "SCLK"), p(24, 8, "spi", "GPIO 8", "CE0"),
  p(25, null, "gnd", "GND"), p(26, 7, "spi", "GPIO 7", "CE1"),
  p(27, 0, "id", "ID_SD", "HAT EEPROM"), p(28, 1, "id", "ID_SC", "HAT EEPROM"),
  p(29, 5, "gpio", "GPIO 5"), p(30, null, "gnd", "GND"),
  p(31, 6, "gpio", "GPIO 6"), p(32, 12, "gpio", "GPIO 12", "PWM0", true),
  p(33, 13, "gpio", "GPIO 13", "PWM1", true), p(34, null, "gnd", "GND"),
  p(35, 19, "gpio", "GPIO 19", "PWM1", true), p(36, 16, "gpio", "GPIO 16"),
  p(37, 26, "gpio", "GPIO 26"), p(38, 20, "gpio", "GPIO 20"),
  p(39, null, "gnd", "GND"), p(40, 21, "gpio", "GPIO 21"),
];

/** Pins the GPIO manager can drive or read (ID_SD/ID_SC belong to the HAT EEPROM). */
export const isUsableGpio = (pin: HeaderPin) => pin.bcm !== null && pin.kind !== "id";

export const PIN_COLORS: Record<PinKind, string> = {
  "3v3": "#f59e0b",
  "5v": "#ef4444",
  gnd: "#52525b",
  gpio: "#22c55e",
  i2c: "#a855f7",
  uart: "#3b82f6",
  spi: "#ec4899",
  id: "#eab308",
};

export const PIN_KIND_LABELS: Record<PinKind, string> = {
  "3v3": "3.3 V",
  "5v": "5 V",
  gnd: "GND",
  gpio: "GPIO",
  i2c: "I²C (GPIO)",
  uart: "UART (GPIO)",
  spi: "SPI (GPIO)",
  id: "HAT EEPROM",
};

// ---------------------------------------------------------------------------
// Board variants

export type PiBoardVariant = "pi5" | "pi4" | "pi3" | "pi3a" | "zero" | "pi400" | "generic";

export const PI_BOARD_LABELS: Record<PiBoardVariant, string> = {
  pi5: "Raspberry Pi 5",
  pi4: "Raspberry Pi 4 Model B",
  pi3: "Raspberry Pi 3 / 2 / 1 Model B(+)",
  pi3a: "Raspberry Pi 3 Model A+",
  zero: "Raspberry Pi Zero / Zero W / Zero 2 W",
  pi400: "Raspberry Pi 400 / 500",
  generic: "40-pin header",
};

/** The board to draw for a /proc/device-tree/model string; generic when unknown. */
export function piBoardVariant(model: string | null | undefined): PiBoardVariant {
  const m = (model ?? "").toLowerCase();
  if (!m.includes("raspberry pi")) return "generic";
  if (/raspberry pi (400|500)/.test(m)) return "pi400";
  if (m.includes("zero")) return "zero";
  if (/raspberry pi 5/.test(m)) return "pi5";
  if (/raspberry pi 4/.test(m)) return "pi4";
  if (/model a/.test(m)) return "pi3a";
  if (/raspberry pi (3|2)|model b/.test(m)) return "pi3";
  return "generic";
}

/** Boards without the 40-pin header (Compute Modules, the original A/B). */
export function hasStandardHeader(model: string | null | undefined): boolean {
  const m = (model ?? "").toLowerCase();
  if (m.includes("compute module")) return false;
  return !/raspberry pi model (a|b)( rev|$)/.test(m);
}

// ---------------------------------------------------------------------------
// RaspberryPiGpioManager options

export type GpioPinMode = "Output" | "Input" | "Pwm";
export type GpioPull = "None" | "Up" | "Down";

export interface GpioPinConfig {
  pin: number;
  mode: GpioPinMode;
  pull: GpioPull;
  activeLow: boolean;
  debounceMs: number;
  initialState: boolean;
  label: string;
}

export const DEFAULT_PIN_CONFIG: Omit<GpioPinConfig, "pin"> = {
  mode: "Output", pull: "None", activeLow: false, debounceMs: 0, initialState: false, label: "",
};

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => {
  if (typeof value !== "string") return fallback;
  return allowed.find((a) => a.toLowerCase() === value.toLowerCase()) ?? fallback;
};

/** The "pins" option, tolerant of key case (the onboard binds case-insensitively). */
export function readPinConfigs(options: unknown): GpioPinConfig[] {
  const o = (options && typeof options === "object" ? options : {}) as Record<string, unknown>;
  const key = Object.keys(o).find((k) => k.toLowerCase() === "pins");
  const list = key ? o[key] : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): GpioPinConfig[] => {
    if (!raw || typeof raw !== "object") return [];
    const r = Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), v]));
    const pin = Number(r.pin);
    if (!Number.isInteger(pin)) return [];
    return [{
      pin,
      mode: pick(r.mode, ["Output", "Input", "Pwm"] as const, "Output"),
      pull: pick(r.pull, ["None", "Up", "Down"] as const, "None"),
      activeLow: r.activelow === true,
      debounceMs: Number.isFinite(Number(r.debouncems)) ? Number(r.debouncems) : 0,
      initialState: r.initialstate === true,
      label: typeof r.label === "string" ? r.label : "",
    }];
  });
}

/** Serialized like the onboard defaults: only what differs from them, sorted by pin. */
export function writePinConfigs(options: unknown, pins: GpioPinConfig[]): Record<string, unknown> {
  const o = { ...((options && typeof options === "object" ? options : {}) as Record<string, unknown>) };
  for (const k of Object.keys(o)) if (k.toLowerCase() === "pins") delete o[k];
  const list = [...pins].sort((a, b) => a.pin - b.pin).map((c) => {
    const out: Record<string, unknown> = { pin: c.pin, mode: c.mode };
    if (c.mode === "Input" && c.pull !== "None") out.pull = c.pull;
    if (c.activeLow) out.activeLow = true;
    if (c.mode === "Input" && c.debounceMs > 0) out.debounceMs = c.debounceMs;
    if (c.mode === "Output" && c.initialState) out.initialState = true;
    if (c.label.trim()) out.label = c.label.trim();
    return out;
  });
  if (list.length > 0) o.pins = list;
  return o;
}

/** Problems of one pin config, mirroring RaspberryPiGpioManager.ValidatePins. */
export function pinProblems(config: GpioPinConfig): string[] {
  const pin = PI_HEADER[config.pin - 1];
  if (!pin) return [`Pin ${config.pin} is not on the 40-pin header.`];
  if (!isUsableGpio(pin)) return [`Pin ${config.pin} (${pin.label}) is not a usable GPIO.`];
  if (config.mode === "Pwm" && !pin.pwm) return [`Pin ${config.pin} has no hardware PWM (only 12, 32, 33, 35).`];
  return [];
}

// ---------------------------------------------------------------------------
// Option helpers shared by both boards

/** Reads an option case-insensitively. */
export function optionValue(options: unknown, name: string): unknown {
  if (!options || typeof options !== "object") return undefined;
  const key = Object.keys(options).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? (options as Record<string, unknown>)[key] : undefined;
}

/** Sets an option, replacing any differently-cased key; undefined removes it. */
export function withOption(options: unknown, name: string, value: unknown): Record<string, unknown> {
  const o = { ...((options && typeof options === "object" ? options : {}) as Record<string, unknown>) };
  for (const k of Object.keys(o)) if (k.toLowerCase() === name.toLowerCase()) delete o[k];
  if (value !== undefined) o[name] = value;
  return o;
}

// ---------------------------------------------------------------------------
// Which channels use a pin

export interface ChannelRef {
  kind: "control" | "telemetry";
  name: string;
  type: string;
  pinManager?: string | null;
  address?: number | null;
}

export function channelsOnPin(channels: ChannelRef[], manager: string, address: number): ChannelRef[] {
  return channels.filter((c) => (c.pinManager || "default") === manager && c.address === address);
}

export const GPIO_READER = "SignalRC.Onboard.Telemetry.GpioPinReader";
export const PWM_READER = "SignalRC.Onboard.Telemetry.PwmOutputReader";

/** A channel name that is not taken yet: base, base2, base3 … */
export function freeChannelName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const clean = base.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "pin";
  if (!used.has(clean)) return clean;
  for (let i = 2; ; i++) if (!used.has(`${clean}${i}`)) return `${clean}${i}`;
}

// ---------------------------------------------------------------------------
// PCA9685 breakout

export const PCA_CHANNELS = 16;
export const PCA_BASE_ADDRESS = 0x40;

/** The six address jumpers A0…A5 as bits of boardAddress. */
export function pcaJumpers(boardAddress: number): boolean[] {
  return Array.from({ length: 6 }, (_, i) => ((boardAddress >> i) & 1) === 1);
}

export const pcaI2cAddress = (boardAddress: number) => `0x${(PCA_BASE_ADDRESS + (boardAddress & 0x3f)).toString(16).toUpperCase()}`;

/** The header pin of a kind (e.g. "gnd") closest to a pin, for wiring hints; same row first. */
export function nearestPin(physical: number, kind: PinKind): HeaderPin | undefined {
  const col = (n: number) => Math.ceil(n / 2);
  return PI_HEADER
    .filter(p => p.kind === kind)
    .sort((a, b) =>
      Math.abs(col(a.physical) - col(physical)) - Math.abs(col(b.physical) - col(physical))
      || Number(a.physical % 2 !== physical % 2) - Number(b.physical % 2 !== physical % 2))[0];
}

/** Electrical level of an input with a switch: pull-up (or external pull-up) reads low while closed. */
export function inputLevel(pull: GpioPull, closed: boolean): "HIGH" | "LOW" {
  return pull === "Down" ? (closed ? "HIGH" : "LOW") : (closed ? "LOW" : "HIGH");
}
