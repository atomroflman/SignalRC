import React, { useEffect, useMemo, useRef, useState } from "react";
import RaspberryPiBoard, { type PinVisual } from "./raspberry-pi-board";
import Pca9685Board, { type PcaChannelVisual, type PcaHoverTarget } from "./pca9685-board";
import {
  DEFAULT_PIN_CONFIG, GPIO_READER, PI_BOARD_LABELS, PI_HEADER, PIN_COLORS, PIN_KIND_LABELS, PWM_READER, PCA_CHANNELS,
  channelsOnPin, freeChannelName, hasStandardHeader, isUsableGpio, optionValue, pcaI2cAddress, piBoardVariant, pinProblems,
  readPinConfigs, withOption, writePinConfigs,
  type ChannelRef, type GpioPinConfig, type HeaderPin, type PiBoardVariant, type PinKind,
} from "./pin-boards";
import { liveBool, liveNumber, useLiveTelemetry } from "./use-live-telemetry";

// Board editor of a pin manager: the board drawn with its real pinout, pins
// hoverable (tooltip) and clickable (select + configure), and buttons that
// prefill a new control or telemetry channel for the selected pin. It edits
// the pin manager's options object; the surrounding editor saves it.

export type BoardKind = "pi" | "pca";

/** Which board editor a pin manager type gets, if any. */
export function boardKindOf(type: string | null | undefined): BoardKind | undefined {
  const t = (type ?? "").trim().toLowerCase();
  if (t === "raspberrypigpiomanager") return "pi";
  if (t === "pca9685pwmextension") return "pca";
  return undefined;
}

export interface NewChannelRequest {
  kind: "control" | "telemetry";
  channelName: string;
  type: string;
  pinManager: string;
  address: number;
  dataType?: number;
  unit?: string;
  decimals?: number;
  readIntervalTicks?: number;
  options?: Record<string, unknown>;
}

export interface OtherPinManager { name: string; type: string; options: unknown }

interface Props {
  carId: number;
  managerName: string;
  kind: BoardKind;
  /** Parsed options; undefined while the JSON is invalid. */
  options: Record<string, unknown> | undefined;
  onOptionsChange: (options: Record<string, unknown>) => void;
  channels: ChannelRef[];
  otherPinManagers: OtherPinManager[];
  boardModel?: string | null;
  onCreateChannel: (request: NewChannelRequest) => void;
}

const fieldClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btn = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";
const btnAdd = "px-2 py-1 bg-sky-950 hover:bg-sky-900 text-sky-100 rounded text-xs border border-sky-800";

// --- tooltip ------------------------------------------------------------------

function useTooltip() {
  const box = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ x: number; y: number; lines: React.ReactNode } | null>(null);
  const show = (lines: React.ReactNode | undefined, e?: React.PointerEvent) => {
    if (!lines || !e || !box.current) { setTip(null); return; }
    const r = box.current.getBoundingClientRect();
    setTip({ x: e.clientX - r.left, y: e.clientY - r.top, lines });
  };
  const view = tip && (
    <div className="pointer-events-none absolute z-20 max-w-[260px] rounded border border-zinc-600 bg-zinc-900/95 px-2 py-1 text-[11px] leading-snug text-zinc-100 shadow-lg"
      style={{ left: Math.max(4, tip.x + 14), top: Math.max(4, tip.y + 14), transform: box.current && tip.x > box.current.clientWidth - 220 ? "translateX(calc(-100% - 28px))" : undefined }}>
      {tip.lines}
    </div>
  );
  return { box, show, view };
}

// --- Raspberry Pi ---------------------------------------------------------------

/** Header pins another pin manager occupies: I²C for PCA9685 boards on bus 1, UART for serial devices. */
function busyPins(others: OtherPinManager[]): Record<number, string> {
  const busy: Record<number, string> = {};
  for (const m of others) {
    const type = m.type.toLowerCase();
    if (type === "pca9685pwmextension") {
      const bus = Number(optionValue(m.options, "i2cBus") ?? 1);
      if (bus === 1) { busy[3] = `I²C SDA for ${m.name}`; busy[5] = `I²C SCL for ${m.name}`; }
    }
    const port = String(optionValue(m.options, "port") ?? optionValue(m.options, "serialPort") ?? "");
    if (/ttyAMA0|ttyS0|serial0/.test(port)) { busy[8] = `UART TX for ${m.name}`; busy[10] = `UART RX for ${m.name}`; }
  }
  return busy;
}

function Legend() {
  const kinds: PinKind[] = ["gpio", "i2c", "uart", "spi", "3v3", "5v", "gnd", "id"];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-zinc-400">
      {kinds.map(k => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: PIN_COLORS[k], background: "#d4af37" }} />
          {PIN_KIND_LABELS[k]}
        </span>
      ))}
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-sky-400" />used by a channel</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-purple-500" />taken by another pin manager</span>
      <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-yellow-300 shadow-[0_0_6px_#fde047]" />live: on</span>
    </div>
  );
}

function PiEditor(props: Props) {
  const { carId, managerName, options, onOptionsChange, channels, otherPinManagers, boardModel, onCreateChannel } = props;
  const detected = piBoardVariant(boardModel);
  const [variant, setVariant] = useState<PiBoardVariant>(detected);
  // The model arrives with the option schemas; follow it until the user picks a board.
  const [picked, setPicked] = useState(false);
  useEffect(() => { if (!picked) setVariant(detected); }, [detected, picked]);
  const [selected, setSelected] = useState<number | undefined>();
  const { box, show, view } = useTooltip();

  const configs = useMemo(() => readPinConfigs(options), [options]);
  const configOf = (pin: number) => configs.find(c => c.pin === pin);
  const busy = useMemo(() => busyPins(otherPinManagers), [otherPinManagers]);

  const readerChannels = useMemo(
    () => channels.filter(c => c.kind === "telemetry" && (c.pinManager || "default") === managerName && c.address != null && (c.type.endsWith("GpioPinReader") || c.type.endsWith("PwmOutputReader"))),
    [channels, managerName]);
  const live = useLiveTelemetry(carId, readerChannels.map(c => c.name));
  const liveOf = (pin: number) => {
    const ch = readerChannels.find(c => c.address === pin);
    return ch ? live[ch.name] : undefined;
  };

  const visuals = useMemo(() => {
    const v: Record<number, PinVisual> = {};
    for (const pin of PI_HEADER) {
      const c = configs.find(x => x.pin === pin.physical);
      const used = channelsOnPin(channels, managerName, pin.physical).length > 0;
      const l = liveOf(pin.physical);
      const on = liveBool(l) ?? ((liveNumber(l) ?? 0) > 0 ? true : undefined);
      v[pin.physical] = { mode: c?.mode, used, live: on === true, problem: c ? pinProblems(c).length > 0 : false };
    }
    return v;
  }, [configs, channels, managerName, live]);

  if (!options) return <div className="text-xs text-amber-300">Options JSON is invalid - fix it below to use the pin editor.</div>;

  const setConfig = (pin: number, next: GpioPinConfig | undefined) => {
    const rest = configs.filter(c => c.pin !== pin);
    onOptionsChange(writePinConfigs(options, next ? [...rest, next] : rest));
  };

  const tooltip = (pin: HeaderPin) => {
    const c = configOf(pin.physical);
    const on = channelsOnPin(channels, managerName, pin.physical);
    const l = liveOf(pin.physical);
    return (
      <>
        <div className="font-semibold">Pin {pin.physical} · {pin.label}{pin.alt ? ` (${pin.alt})` : ""}</div>
        <div className="text-zinc-400">{PIN_KIND_LABELS[pin.kind]}{pin.bcm !== null ? ` · BCM ${pin.bcm}` : ""}{pin.pwm ? " · hardware PWM" : ""}</div>
        {c && <div>{c.mode}{c.mode === "Input" && c.pull !== "None" ? `, pull-${c.pull.toLowerCase()}` : ""}{c.activeLow ? ", active low" : ""}{c.label ? ` - ${c.label}` : ""}</div>}
        {busy[pin.physical] && <div className="text-purple-300">{busy[pin.physical]}</div>}
        {on.map(ch => <div key={ch.kind + ch.name} className="text-sky-300">{ch.kind}: {ch.name} ({ch.type.split(".").pop()})</div>)}
        {l && <div className="text-yellow-200">live: {l.state === "invalid" ? `– (${l.reason ?? "invalid"})` : String(l.value)}</div>}
        {isUsableGpio(pin) && <div className="text-zinc-500 mt-0.5">Click to configure</div>}
      </>
    );
  };

  const pin = selected ? PI_HEADER[selected - 1] : undefined;
  const config = pin ? configOf(pin.physical) : undefined;
  const pinChannels = pin ? channelsOnPin(channels, managerName, pin.physical) : [];
  const taken = channels.map(c => c.name);

  const create = (kind: "control" | "telemetry", type: string, suffix: string, extra: Partial<NewChannelRequest> = {}) => {
    if (!pin) return;
    const base = (config?.label || `gpio${pin.physical}`) + suffix;
    onCreateChannel({ kind, type, channelName: freeChannelName(base, taken), pinManager: managerName, address: pin.physical, ...extra });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>Board</span>
        <select className={fieldClass} value={variant} onChange={e => { setPicked(true); setVariant(e.target.value as PiBoardVariant); }}>
          {(Object.keys(PI_BOARD_LABELS) as PiBoardVariant[]).map(v => <option key={v} value={v}>{PI_BOARD_LABELS[v]}{v === detected && boardModel ? " (detected)" : ""}</option>)}
        </select>
        <span className="text-zinc-500">{boardModel ? `Vehicle reports: ${boardModel}` : "Vehicle model unknown (offline or older onboard build)"}</span>
        {boardModel && !hasStandardHeader(boardModel) && <span className="text-amber-300">This board has no standard 40-pin header.</span>}
      </div>

      <div ref={box} className="relative overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2" onPointerLeave={() => show(undefined)}>
        <div className={variant === "zero" || variant === "pi3a" || variant === "generic" ? "min-w-[480px] max-w-[640px]" : "min-w-[560px] max-w-[820px]"}>
          <RaspberryPiBoard variant={variant} pins={visuals} selected={selected} busy={busy}
            onSelect={p => setSelected(s => (s === p ? undefined : p))}
            onHover={(p, e) => show(p ? tooltip(p) : undefined, e)} />
        </div>
        {view}
      </div>
      <Legend />

      {configs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...configs].sort((a, b) => a.pin - b.pin).map(c => (
            <button key={c.pin} className={`${btn} ${selected === c.pin ? "!border-white" : ""} ${pinProblems(c).length ? "!border-red-700" : ""}`} onClick={() => setSelected(c.pin)}>
              <span className="font-mono">{c.pin}</span> {c.mode === "Input" ? "IN" : c.mode === "Pwm" ? "PWM" : "OUT"}{c.label ? ` · ${c.label}` : ""}
            </button>
          ))}
        </div>
      )}

      {pin && (
        <div className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-zinc-100">Pin {pin.physical} · {pin.label}</span>
              <span className="ml-2 rounded px-1 text-[10px] text-zinc-900" style={{ background: PIN_COLORS[pin.kind] }}>{PIN_KIND_LABELS[pin.kind]}</span>
              {pin.bcm !== null && <span className="ml-2 text-zinc-500">BCM {pin.bcm}{pin.alt ? ` · alt: ${pin.alt}` : ""}</span>}
            </div>
            <button className={btn} onClick={() => setSelected(undefined)}>Close</button>
          </div>

          {!isUsableGpio(pin) ? (
            <div className="text-zinc-400">
              {pin.kind === "id" ? "Reserved for the HAT ID EEPROM - leave unconnected unless you build a HAT." : `${pin.label} supply pin - nothing to configure.`}
            </div>
          ) : (
            <>
              {busy[pin.physical] && <div className="text-purple-300">Taken: {busy[pin.physical]}. Using it as GPIO breaks that device.</div>}
              {pin.kind !== "gpio" && !busy[pin.physical] && <div className="text-zinc-500">Usable as GPIO while {pin.alt} ({PIN_KIND_LABELS[pin.kind]}) is disabled on the Pi.</div>}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-zinc-400">Mode
                  <select className={fieldClass} value={config?.mode ?? ""} onChange={e => {
                    const mode = e.target.value as GpioPinConfig["mode"] | "";
                    setConfig(pin.physical, mode ? { ...DEFAULT_PIN_CONFIG, ...config, pin: pin.physical, mode, ...(mode === "Input" && !config ? { pull: "Up", activeLow: true, debounceMs: 20 } : {}) } : undefined);
                  }}>
                    <option value="">not configured</option>
                    <option value="Output">Output</option>
                    <option value="Input">Input</option>
                    {pin.pwm && <option value="Pwm">Hardware PWM</option>}
                  </select>
                </label>
                {config && (
                  <label className="flex flex-col gap-1 text-zinc-400">Label
                    <input className={fieldClass} value={config.label} placeholder="e.g. endstop front" onChange={e => setConfig(pin.physical, { ...config, label: e.target.value })} />
                  </label>
                )}
                {config?.mode === "Input" && (
                  <>
                    <label className="flex flex-col gap-1 text-zinc-400">Pull resistor
                      <select className={fieldClass} value={config.pull} onChange={e => setConfig(pin.physical, { ...config, pull: e.target.value as GpioPinConfig["pull"] })}>
                        <option value="None">none (external)</option>
                        <option value="Up">pull-up (switch to GND)</option>
                        <option value="Down">pull-down (switch to 3.3 V)</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-zinc-400">Debounce (ms)
                      <input className={fieldClass + " w-20"} type="number" min={0} value={config.debounceMs} onChange={e => setConfig(pin.physical, { ...config, debounceMs: Math.max(0, Number(e.target.value) || 0) })} />
                    </label>
                  </>
                )}
                {config?.mode === "Output" && (
                  <label className="flex items-center gap-1 text-zinc-400">
                    <input type="checkbox" checked={config.initialState} onChange={e => setConfig(pin.physical, { ...config, initialState: e.target.checked })} /> on at start
                  </label>
                )}
                {config && config.mode !== "Pwm" && (
                  <label className="flex items-center gap-1 text-zinc-400" title="Logical on = electrical low">
                    <input type="checkbox" checked={config.activeLow} onChange={e => setConfig(pin.physical, { ...config, activeLow: e.target.checked })} /> active low
                  </label>
                )}
              </div>
              {config?.mode === "Input" && config.pull === "Up" && !config.activeLow && (
                <div className="text-amber-300">With pull-up a closed switch reads low - you probably want “active low”.</div>
              )}
              {config?.mode === "Input" && <div className="text-zinc-500">Inputs are 3.3 V only. Never connect 5 V to a GPIO.</div>}
              {config && pinProblems(config).map(p => <div key={p} className="text-red-300">{p}</div>)}

              <div className="space-y-1">
                <div className="text-zinc-400">Channels on this pin</div>
                {pinChannels.length === 0 && <div className="text-zinc-500">none yet</div>}
                {pinChannels.map(ch => (
                  <div key={ch.kind + ch.name} className="font-mono text-sky-300">
                    {ch.kind === "control" ? "⇢" : "⇠"} {ch.name} <span className="text-zinc-500">{ch.type.split(".").pop()}</span>
                    {ch.kind === "telemetry" && live[ch.name] && <span className="ml-2 text-yellow-200">= {live[ch.name].state === "invalid" ? "–" : String(live[ch.name].value)}</span>}
                  </div>
                ))}
                <div className="flex flex-wrap gap-1 pt-1">
                  {config?.mode !== "Pwm" && config?.mode !== "Output" && (
                    <button className={btnAdd} onClick={() => create("telemetry", GPIO_READER, "", { dataType: 3, readIntervalTicks: 1 })}>+ Telemetry: input state</button>
                  )}
                  {config?.mode !== "Pwm" && config?.mode !== "Input" && (
                    <>
                      <button className={btnAdd} onClick={() => create("control", "GpioOutput", "")}>+ Control: switch output</button>
                      <button className={btnAdd} onClick={() => create("telemetry", GPIO_READER, "State", { dataType: 3, readIntervalTicks: 1, options: { latch: false } })}>+ Telemetry: output state</button>
                    </>
                  )}
                  {pin.pwm && (config?.mode === "Pwm" || !config) && (
                    <>
                      <button className={btnAdd} onClick={() => create("control", "PwmLight", "")}>+ Control: PWM</button>
                      <button className={btnAdd} onClick={() => create("telemetry", PWM_READER, "Pwm", { dataType: 2, unit: "%", decimals: 0, readIntervalTicks: 2 })}>+ Telemetry: PWM output</button>
                    </>
                  )}
                </div>
                {!config && <div className="text-zinc-500">Tip: set a mode first - unconfigured pins become an output on the first write and an input on the first read.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- PCA9685 ------------------------------------------------------------------------

const PCA_CONTROL_HINTS: Record<string, string> = {
  GND: "Ground - Pi pin 6 (or any GND).",
  OE: "Output enable, active low. Leave open (pulled low on the board) or tie to a GPIO to switch all outputs off.",
  SCL: "I²C clock - Pi pin 5 (GPIO 3).",
  SDA: "I²C data - Pi pin 3 (GPIO 2).",
  VCC: "Logic supply 3.3 V - Pi pin 1. Not the servo supply!",
  "V+": "Servo supply (5–6 V) from an external source. Never from the Pi's 5 V pin under load.",
};

function PcaEditor(props: Props) {
  const { carId, managerName, options, onOptionsChange, channels, onCreateChannel } = props;
  const [selected, setSelected] = useState<number | undefined>();
  const { box, show, view } = useTooltip();
  const boardAddress = Number(optionValue(options, "boardAddress") ?? 0) || 0;
  const i2cBus = Number(optionValue(options, "i2cBus") ?? 1);

  const readerChannels = useMemo(
    () => channels.filter(c => c.kind === "telemetry" && (c.pinManager || "default") === managerName && c.address != null && c.type.endsWith("PwmOutputReader")),
    [channels, managerName]);
  const live = useLiveTelemetry(carId, readerChannels.map(c => c.name));
  const liveOf = (ch: number) => {
    const r = readerChannels.find(c => c.address === ch);
    return r ? live[r.name] : undefined;
  };
  const visuals = useMemo(() => {
    const v: Record<number, PcaChannelVisual> = {};
    for (let ch = 0; ch < PCA_CHANNELS; ch++) {
      const l = liveOf(ch);
      const n = liveNumber(l);
      // PwmOutputReader reports percent by default; a value ≤ 1 with another unit still reads sensibly.
      v[ch] = { used: channelsOnPin(channels, managerName, ch).length > 0, duty: n === undefined ? undefined : n > 1 ? n / 100 : n, fault: l?.state === "invalid" && l.reason === "source-error" };
    }
    return v;
  }, [channels, managerName, live]);

  if (!options) return <div className="text-xs text-amber-300">Options JSON is invalid - fix it below to use the board editor.</div>;

  const tooltip = (t: PcaHoverTarget): React.ReactNode => {
    switch (t.kind) {
      case "channel": {
        const on = channelsOnPin(channels, managerName, t.channel);
        const l = liveOf(t.channel);
        return (
          <>
            <div className="font-semibold">Channel {t.channel} · {t.row === "pwm" ? "PWM signal" : t.row === "v+" ? "V+ (servo supply)" : "GND"}</div>
            {on.map(ch => <div key={ch.kind + ch.name} className="text-sky-300">{ch.kind}: {ch.name} ({ch.type.split(".").pop()})</div>)}
            {l && <div className="text-yellow-200">live: {l.state === "invalid" ? `– (${l.reason ?? "invalid"})` : String(l.value)}</div>}
            <div className="text-zinc-500 mt-0.5">Click to select the channel</div>
          </>
        );
      }
      case "control":
        return <><div className="font-semibold">{t.pin}</div><div>{PCA_CONTROL_HINTS[t.pin]}</div></>;
      case "terminal":
        return <><div className="font-semibold">Screw terminal {t.pin}</div><div>{t.pin === "V+" ? PCA_CONTROL_HINTS["V+"] : "Ground of the servo supply - connect it to the Pi's GND too."}</div></>;
      case "jumper":
        return <><div className="font-semibold">Address jumper A{t.bit}</div><div>{(boardAddress >> t.bit) & 1 ? "bridged" : "open"} · adds {1 << t.bit} to 0x40</div><div className="text-zinc-500 mt-0.5">Click to toggle in the config (solder it to match)</div></>;
    }
  };

  const ch = selected;
  const chChannels = ch !== undefined ? channelsOnPin(channels, managerName, ch) : [];
  const taken = channels.map(c => c.name);
  const create = (kind: "control" | "telemetry", type: string, suffix: string, extra: Partial<NewChannelRequest> = {}) => {
    if (ch === undefined) return;
    onCreateChannel({ kind, type, channelName: freeChannelName(`${managerName}Ch${ch}${suffix}`, taken), pinManager: managerName, address: ch, ...extra });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3 text-xs text-zinc-400">
        <label className="flex flex-col gap-1">I²C bus
          <input className={fieldClass + " w-16"} type="number" min={0} max={15} value={i2cBus} onChange={e => onOptionsChange(withOption(options, "i2cBus", Number(e.target.value)))} />
        </label>
        <label className="flex flex-col gap-1">Board address (A0–A5)
          <input className={fieldClass + " w-16"} type="number" min={0} max={63} value={boardAddress} onChange={e => onOptionsChange(withOption(options, "boardAddress", Math.max(0, Math.min(63, Number(e.target.value) || 0))))} />
        </label>
        <span className="pb-1">I²C address <span className="font-mono text-zinc-200">{pcaI2cAddress(boardAddress)}</span> on /dev/i2c-{i2cBus}{i2cBus === 1 ? " (Pi pins 3/5)" : ""}</span>
      </div>
      <div ref={box} className="relative overflow-x-auto rounded border border-zinc-800 bg-zinc-950 p-2" onPointerLeave={() => show(undefined)}>
        <div className="min-w-[560px] max-w-[820px]">
          <Pca9685Board channels={visuals} selected={selected} boardAddress={boardAddress}
            onSelect={c => setSelected(s => (s === c ? undefined : c))}
            onToggleJumper={bit => onOptionsChange(withOption(options, "boardAddress", boardAddress ^ (1 << bit)))}
            onHover={(t, e) => show(t ? tooltip(t) : undefined, e)} />
        </div>
        {view}
      </div>
      <div className="text-[10px] text-zinc-500">Wiring: VCC → Pi pin 1 (3.3 V), SDA → pin 3, SCL → pin 5, GND → pin 6. Servo power on V+ from a separate supply.</div>

      {ch !== undefined && (
        <div className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-100">Channel {ch}</span>
            <button className={btn} onClick={() => setSelected(undefined)}>Close</button>
          </div>
          {chChannels.length === 0 && <div className="text-zinc-500">No channel uses it yet.</div>}
          {chChannels.map(c => (
            <div key={c.kind + c.name} className="font-mono text-sky-300">
              {c.kind === "control" ? "⇢" : "⇠"} {c.name} <span className="text-zinc-500">{c.type.split(".").pop()}</span>
              {c.kind === "telemetry" && live[c.name] && <span className="ml-2 text-yellow-200">= {live[c.name].state === "invalid" ? "–" : String(live[c.name].value)}</span>}
            </div>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            <button className={btnAdd} onClick={() => create("control", "PwmLight", "")}>+ Control: light / PWM</button>
            <button className={btnAdd} onClick={() => create("control", "Steering", "Servo")}>+ Control: servo</button>
            <button className={btnAdd} onClick={() => create("telemetry", PWM_READER, "Out", { dataType: 2, unit: "%", decimals: 0, readIntervalTicks: 2 })}>+ Telemetry: output readback</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PinBoardEditor(props: Props) {
  return props.kind === "pi" ? <PiEditor {...props} /> : <PcaEditor {...props} />;
}
