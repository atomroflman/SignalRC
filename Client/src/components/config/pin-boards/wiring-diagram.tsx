import React, { forwardRef, useMemo } from "react";
import RaspberryPiBoard, { pinPosition, piBoardSize, type PinVisual } from "./raspberry-pi-board";
import Pca9685Board, { PCA_H, PCA_W, ROW_Y, channelX, controlPinPosition, type PcaChannelVisual } from "./pca9685-board";
import { CARD_H, CARD_W, DeviceCard, SUPPLY_H, SUPPLY_W, SupplyBox, supplyTerminal, terminalPosition, terminalsOf, type ArtState, type CardSide, type TerminalName } from "./device-art";
import { PI_HEADER, type PiBoardVariant } from "./pin-boards";
import type { WiringDevice, WiringDiagram, WiringExternal, WiringReader } from "./wiring-model";
import type { QualifiedValue } from "@/components/overlay/sources";
import { liveBool, liveNumber } from "./use-live-telemetry";

// The whole vehicle on one sheet: the Raspberry Pi with the parts on its
// header above it, the PCA9685 boards to its right on the I²C bus with their
// parts hanging below, power supplies, and CAN/serial devices under the Pi.
// Units are millimetres; boards are drawn at their real size.

type Pt = { x: number; y: number };
type Dir = Pt;
const UP: Dir = { x: 0, y: -1 };
const DOWN: Dir = { x: 0, y: 1 };
const LEFT: Dir = { x: -1, y: 0 };
const RIGHT: Dir = { x: 1, y: 0 };

export interface Wire {
  id: string;
  device?: string;
  from: Pt;
  fromDir: Dir;
  to: Pt;
  toDir: Dir;
  color: string;
  label: string;
  width?: number;
}

const GAP = 3;
const PER_ROW = 8;
const SIGNAL_COLORS = ["#22c55e", "#eab308", "#3b82f6", "#ec4899", "#14b8a6", "#f97316", "#a855f7", "#e4e4e7"];
const C = { gnd: "#0a0a0a", v33: "#f59e0b", v5: "#ef4444", vplus: "#dc2626", sda: "#3b82f6", scl: "#eab308" };

function wirePath(w: Wire) {
  const dist = Math.hypot(w.to.x - w.from.x, w.to.y - w.from.y);
  const k = Math.max(5, Math.min(30, dist * 0.45));
  const c1 = { x: w.from.x + w.fromDir.x * k, y: w.from.y + w.fromDir.y * k };
  const c2 = { x: w.to.x + w.toDir.x * k, y: w.to.y + w.toDir.y * k };
  return `M ${w.from.x} ${w.from.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${w.to.x} ${w.to.y}`;
}

/** Live state of a part from its readers. */
function artState(d: WiringDevice, live: Record<string, QualifiedValue>): ArtState {
  const s: ArtState = {};
  for (const r of d.readers) {
    const v = live[r.name];
    if (r.type === "gpio") {
      const b = liveBool(v);
      if (b !== undefined) { s.active = b; if (d.kind !== "button" && d.kind !== "input") s.on = b ? 1 : 0; }
    } else {
      const n = liveNumber(v);
      if (n === undefined) continue;
      const ms = pulseMs(r, n);
      if (d.kind === "servo" || d.kind === "esc") s.angle = Math.max(-70, Math.min(70, (ms - 1.5) * 120));
      else s.on = Math.max(0, Math.min(1, ms / 20));
    }
  }
  return s;
}

/** A PwmOutputReader value as pulse width in ms at 50 Hz. */
export function pulseMs(r: WiringReader, value: number): number {
  switch (r.report.toLowerCase()) {
    case "pulsewidthms": return value;
    case "pulsewidthus": return value / 1000;
    case "dutycycle": return value * 20;
    case "counts": return (value / 4096) * 20;
    default: return (value / 100) * 20;
  }
}

export interface Layout {
  width: number;
  height: number;
  minX: number;
  minY: number;
  pi: Pt;
  piCards: { device: WiringDevice; at: Pt }[];
  piSupply?: Pt;
  pcas: { name: string; at: Pt; cards: { device: WiringDevice; at: Pt }[]; supply?: Pt }[];
  externals: { ext: WiringExternal; at: Pt }[];
  wires: Wire[];
}

const EXT_W = 36;
const EXT_H = 11;

export function layoutWiring(d: WiringDiagram, variant: PiBoardVariant): Layout {
  const piSize = piBoardSize(variant);
  const wires: Wire[] = [];
  const signalColor = new Map<string, string>();
  const colorOf = (id: string) => {
    if (!signalColor.has(id)) signalColor.set(id, SIGNAL_COLORS[signalColor.size % SIGNAL_COLORS.length]);
    return signalColor.get(id)!;
  };

  // Parts on the Pi header: rows above the board, ordered by header column.
  const piRows = Math.ceil(d.piDevices.length / PER_ROW);
  const needsPiSupply = d.piDevices.some(x => x.kind === "servo" || x.kind === "esc");
  const top = needsPiSupply ? SUPPLY_H + 8 : 0;
  const pi: Pt = { x: 0, y: top + piRows * (CARD_H + 14) + (piRows > 0 ? 14 : 0) };
  const headerMid = pi.x + (pinPosition(variant, 1).x + pinPosition(variant, 40).x) / 2;
  const piCards = d.piDevices.map((device, i) => {
    const row = Math.floor(i / PER_ROW);
    const inRow = Math.min(PER_ROW, d.piDevices.length - row * PER_ROW);
    const col = i % PER_ROW;
    const x = headerMid - (inRow * (CARD_W + GAP) - GAP) / 2 + col * (CARD_W + GAP);
    const y = top + (piRows - 1 - row) * (CARD_H + 14);
    return { device, at: { x, y } };
  });
  const cardsLeft = Math.min(headerMid, ...piCards.map(c => c.at.x));
  const piSupply = needsPiSupply ? { x: cardsLeft - SUPPLY_W - 6, y: 0 } : undefined;

  const pinPt = (physical: number): Pt => {
    const p = pinPosition(variant, physical);
    return { x: pi.x + p.x, y: pi.y + p.y };
  };
  const term = (at: Pt, side: CardSide, t: TerminalName) => terminalPosition(at.x, at.y, side, t);

  for (const { device, at } of piCards) {
    const pin = (device.endpoint as { pin: number }).pin;
    const header = PI_HEADER[pin - 1];
    const sig = colorOf(device.id);
    const id = device.id;
    const add = (n: string, fromPin: number | undefined, t: TerminalName, color: string, label: string) => {
      if (!fromPin) return;
      wires.push({ id: `${id}:${n}`, device: id, from: pinPt(fromPin), fromDir: UP, to: term(at, "bottom", t), toDir: DOWN, color, label });
    };
    add("sig", pin, "sig", sig, `Pin ${pin} (${header.label}) → ${device.title}`);
    switch (device.kind) {
      case "relay":
        add("vcc", device.v5, "plus", C.v5, `Pin ${device.v5} (5 V) → ${device.title} VCC`);
        add("gnd", device.gnd, "gnd", C.gnd, `Pin ${device.gnd} (GND) → ${device.title} GND`);
        break;
      case "servo": case "esc":
        add("gnd", device.gnd, "gnd", C.gnd, `Pin ${device.gnd} (GND) → ${device.title} −`);
        if (piSupply) {
          wires.push({ id: `${id}:vplus`, device: id, from: supplyTerminal(piSupply.x, piSupply.y, "plus"), fromDir: DOWN, to: term(at, "bottom", "plus"), toDir: DOWN, color: C.vplus, label: `BEC + → ${device.title} +` });
        }
        break;
      case "button": {
        const pull = device.pin?.pull ?? "None";
        if (pull === "Down") add("ret", device.v33, "gnd", C.v33, `Pin ${device.v33} (3.3 V) → ${device.title}`);
        else add("ret", device.gnd, "gnd", C.gnd, `Pin ${device.gnd} (GND) → ${device.title}`);
        if (pull === "None") add("pullup", device.v33, "plus", C.v33, `Pin ${device.v33} (3.3 V) → 10 kΩ pull-up`);
        break;
      }
      default:
        add("gnd", device.gnd, "gnd", C.gnd, `Pin ${device.gnd} (GND) → ${device.title} −`);
    }
  }
  if (piSupply) {
    const gndPin = d.piDevices.find(x => x.kind === "servo" || x.kind === "esc")?.gnd ?? 6;
    wires.push({ id: "pi-supply:gnd", from: supplyTerminal(piSupply.x, piSupply.y, "minus"), fromDir: DOWN, to: pinPt(gndPin), toDir: UP, color: C.gnd, label: `BEC − → Pin ${gndPin} (GND, common ground)` });
  }

  // PCA9685 boards in a row right of the Pi, parts hanging below each.
  let x = pi.x + piSize.w + 45;
  const pcas: Layout["pcas"] = [];
  d.pcas.forEach((p, i) => {
    const cols = Math.min(PER_ROW, Math.max(1, p.devices.length));
    const cardsW = cols * (CARD_W + GAP) - GAP;
    const slot = Math.max(PCA_W, cardsW);
    const at = { x: x + (slot - PCA_W) / 2, y: pi.y };
    const cards = p.devices.map((device, j) => {
      const row = Math.floor(j / PER_ROW);
      const inRow = Math.min(PER_ROW, p.devices.length - row * PER_ROW);
      const cx = at.x + PCA_W / 2 - (inRow * (CARD_W + GAP) - GAP) / 2 + (j % PER_ROW) * (CARD_W + GAP);
      return { device, at: { x: cx, y: at.y + PCA_H + 22 + row * (CARD_H + 10) } };
    });
    const supply = p.devices.length > 0 ? { x: at.x + 4, y: at.y - SUPPLY_H - 14 } : undefined;
    pcas.push({ name: p.name, at, cards, supply });

    // I²C: first board on a bus from the Pi header, the next ones chained from the previous board.
    const prev = i > 0 && d.pcas[i - 1].bus === p.bus ? pcas[i - 1] : undefined;
    const bus = [
      { n: "VCC" as const, pin: 1, color: C.v33 },
      { n: "SDA" as const, pin: 3, color: C.sda },
      { n: "SCL" as const, pin: 5, color: C.scl },
      { n: "GND" as const, pin: 6, color: C.gnd },
    ];
    for (const b of bus) {
      const target = controlPinPosition("left", b.n);
      const to = { x: at.x + target.x, y: at.y + target.y };
      if (prev) {
        const src = controlPinPosition("right", b.n);
        wires.push({ id: `${p.name}:i2c:${b.n}`, from: { x: prev.at.x + src.x, y: prev.at.y + src.y }, fromDir: RIGHT, to, toDir: LEFT, color: b.color, label: `${prev.name} ${b.n} → ${p.name} ${b.n} (chained)` });
      } else {
        wires.push({ id: `${p.name}:i2c:${b.n}`, from: pinPt(b.pin), fromDir: UP, to, toDir: LEFT, color: b.color, label: `Pin ${b.pin} (${PI_HEADER[b.pin - 1].alt ?? PI_HEADER[b.pin - 1].label}) → ${p.name} ${b.n}` });
      }
    }
    if (supply) {
      wires.push({ id: `${p.name}:vplus`, from: supplyTerminal(supply.x, supply.y, "plus"), fromDir: DOWN, to: { x: at.x + 12.5, y: at.y + 1.5 }, toDir: UP, color: C.vplus, label: `BEC + → ${p.name} V+ terminal`, width: 1 });
      wires.push({ id: `${p.name}:vgnd`, from: supplyTerminal(supply.x, supply.y, "minus"), fromDir: DOWN, to: { x: at.x + 17.5, y: at.y + 1.5 }, toDir: UP, color: C.gnd, label: `BEC − → ${p.name} GND terminal`, width: 1 });
    }
    // Servo-style cables: three strands out of the plug on the channel column.
    for (const { device, at: cardAt } of cards) {
      const ch = (device.endpoint as { channel: number }).channel;
      const cx = at.x + channelX(ch);
      const plugBottom = at.y + ROW_Y.gnd + 1.3;
      const strands: { t: TerminalName; dx: number; color: string; label: string }[] = [
        { t: "gnd", dx: -0.75, color: device.kind === "led" ? C.gnd : "#78350f", label: "GND" },
        ...(terminalsOf(device).includes("plus") ? [{ t: "plus" as const, dx: 0, color: C.vplus, label: "V+" }] : []),
        { t: "sig", dx: 0.75, color: device.kind === "servo" || device.kind === "esc" ? "#f97316" : colorOf(device.id), label: "PWM" },
      ];
      for (const s of strands)
        wires.push({ id: `${device.id}:${s.t}`, device: device.id, from: { x: cx + s.dx, y: plugBottom }, fromDir: DOWN, to: term(cardAt, "top", s.t), toDir: UP, color: s.color, label: `${p.name} ch ${ch} ${s.label} → ${device.title}`, width: 0.55 });
    }
    x += slot + 40;
  });

  // CAN / serial devices below the Pi.
  const externals = d.externals.map((ext, i) => ({ ext, at: { x: pi.x + i * (EXT_W + 6), y: pi.y + piSize.h + 16 } }));

  // Bounds.
  const xs: number[] = [pi.x - 4, pi.x + piSize.w + 4];
  const ys: number[] = [0, pi.y + piSize.h + 4];
  for (const c of piCards) { xs.push(c.at.x, c.at.x + CARD_W); ys.push(c.at.y); }
  if (piSupply) { xs.push(piSupply.x); ys.push(piSupply.y); }
  for (const p of pcas) {
    xs.push(p.at.x - 4, p.at.x + PCA_W + 4);
    if (p.supply) ys.push(p.supply.y);
    for (const c of p.cards) { xs.push(c.at.x, c.at.x + CARD_W); ys.push(c.at.y + CARD_H); }
  }
  for (const e of externals) { xs.push(e.at.x + EXT_W); ys.push(e.at.y + EXT_H); }
  const pad = 6;
  const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad - 4, maxY = Math.max(...ys) + pad;
  return { width: maxX - minX, height: maxY - minY, minX, minY, pi, piCards, piSupply, pcas, externals, wires };
}

const EXT_ICON: Record<WiringExternal["kind"], string> = { can: "CAN", lidar: "LiDAR", bms: "BMS", other: "I/O" };

export interface WiringDiagramProps {
  diagram: WiringDiagram;
  variant: PiBoardVariant;
  live: Record<string, QualifiedValue>;
  highlighted?: string;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string) => void;
}

const noop = () => {};

const WiringDiagramView = forwardRef<SVGSVGElement, WiringDiagramProps>(function WiringDiagramView({ diagram, variant, live, highlighted, onHover, onSelect }, ref) {
  const layout = useMemo(() => layoutWiring(diagram, variant), [diagram, variant]);
  const { pi, minX, minY, width, height } = layout;
  const piSize = piBoardSize(variant);

  const pinVisuals = useMemo(() => {
    const v: Record<number, PinVisual> = {};
    for (const d of diagram.piDevices) {
      const pin = (d.endpoint as { pin: number }).pin;
      const gpio = d.readers.find(r => r.type === "gpio");
      v[pin] = { mode: d.pin?.mode, used: d.controls.length + d.readers.length > 0, live: gpio ? liveBool(live[gpio.name]) === true : undefined };
    }
    return v;
  }, [diagram, live]);
  const busy = useMemo(() => {
    const b: Record<number, string> = {};
    if (diagram.pcas.some(p => p.bus === 1)) { b[3] = "I²C SDA"; b[5] = "I²C SCL"; }
    return b;
  }, [diagram]);

  const subtitle = (d: WiringDevice) => {
    const where = d.endpoint.board === "pi"
      ? `pin ${d.endpoint.pin} · ${PI_HEADER[d.endpoint.pin - 1].label}`
      : `${d.endpoint.manager} · ch ${d.endpoint.channel}`;
    const channel = d.controls[0] ?? d.readers[0]?.name;
    return channel && channel !== d.title ? `${where} · ${channel}` : where;
  };

  const wireOpacity = (w: Wire) => (!highlighted ? 1 : w.device === highlighted ? 1 : 0.18);

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`${minX} ${minY} ${width} ${height}`} className="w-full h-auto select-none"
      style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif", background: "#0f0f12" }} role="img" aria-label="Wiring diagram">
      <defs>
        <filter id="wiring-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4" /></filter>
      </defs>
      <rect x={minX} y={minY} width={width} height={height} fill="#0f0f12" />

      <RaspberryPiBoard variant={variant} pins={pinVisuals} busy={busy} onSelect={noop} onHover={noop} at={pi} />
      <text x={pi.x} y={pi.y + piSize.h + 6} fontSize={2.4} fill="#d4d4d8" fontWeight={600}>{diagram.boardModel ?? "Raspberry Pi"}</text>

      {layout.pcas.map(p => {
        const pca = diagram.pcas.find(x => x.name === p.name)!;
        const channels: Record<number, PcaChannelVisual> = {};
        for (const d of pca.devices) {
          const ch = (d.endpoint as { channel: number }).channel;
          const pwm = d.readers.find(r => r.type === "pwm");
          const n = pwm ? liveNumber(live[pwm.name]) : undefined;
          channels[ch] = { used: true, duty: pwm && n !== undefined ? pulseMs(pwm, n) / 20 : undefined, fault: pwm ? live[pwm.name]?.state === "invalid" : false };
        }
        return (
          <g key={p.name}>
            <Pca9685Board channels={channels} boardAddress={pca.boardAddress} onSelect={noop} onToggleJumper={noop} onHover={noop} at={p.at} />
            <text x={p.at.x + PCA_W} y={p.at.y - 8} fontSize={2.4} fill="#d4d4d8" fontWeight={600} textAnchor="end">{p.name}</text>
            <text x={p.at.x + PCA_W} y={p.at.y - 5} fontSize={1.6} fill="#a1a1aa" textAnchor="end">PCA9685 · I²C bus {pca.bus} · {pca.i2cAddress}</text>
            {p.supply && <SupplyBox x={p.supply.x} y={p.supply.y} title="BEC 5–6 V" sub={pca.devices.some(d => d.kind === "esc") ? "or the ESC's BEC (only one)" : "servo power, not from the Pi"} />}
          </g>
        );
      })}
      {layout.piSupply && <SupplyBox x={layout.piSupply.x} y={layout.piSupply.y} title="BEC 5–6 V" sub="servo power, GND to the Pi" />}

      {/* Wires: dark casing, coloured core, connector at both ends. */}
      {layout.wires.map(w => {
        const d = wirePath(w);
        const width = w.width ?? 0.7;
        return (
          <g key={w.id} opacity={wireOpacity(w)} onPointerEnter={() => w.device && onHover(w.device)} onPointerLeave={() => onHover(undefined)}
            onClick={() => w.device && onSelect(w.device)} style={{ cursor: w.device ? "pointer" : undefined }}>
            <title>{w.label}</title>
            <path d={d} fill="none" stroke="transparent" strokeWidth={2.4} />
            <path d={d} fill="none" stroke={w.color === C.gnd ? "#71717a" : "#000000"} strokeOpacity={0.75} strokeWidth={width + 0.35} strokeLinecap="round" />
            <path d={d} fill="none" stroke={w.color} strokeWidth={width} strokeLinecap="round" />
            <rect x={w.from.x - 0.55} y={w.from.y - 0.55} width={1.1} height={1.1} rx={0.15} fill="#18181b" stroke={w.color} strokeWidth={0.2} />
          </g>
        );
      })}

      {/* Servo plugs on the PCA channel columns. */}
      {layout.pcas.flatMap(p => p.cards.map(({ device }) => {
        const ch = (device.endpoint as { channel: number }).channel;
        const cx = p.at.x + channelX(ch);
        return <rect key={`plug-${device.id}`} x={cx - 1.25} y={p.at.y + ROW_Y.pwm - 1.35} width={2.5} height={ROW_Y.gnd - ROW_Y.pwm + 2.7} rx={0.3} fill="#18181b" stroke="#52525b" strokeWidth={0.15} opacity={highlighted && highlighted !== device.id ? 0.4 : 0.95} pointerEvents="none" />;
      }))}

      {layout.piCards.map(({ device, at }) => (
        <DeviceCard key={device.id} device={device} x={at.x} y={at.y} side="bottom" subtitle={subtitle(device)} state={artState(device, live)}
          highlighted={highlighted === device.id} dimmed={!!highlighted && highlighted !== device.id} onHover={onHover} onSelect={onSelect} />
      ))}
      {layout.pcas.flatMap(p => p.cards.map(({ device, at }) => (
        <DeviceCard key={device.id} device={device} x={at.x} y={at.y} side="top" subtitle={subtitle(device)} state={artState(device, live)}
          highlighted={highlighted === device.id} dimmed={!!highlighted && highlighted !== device.id} onHover={onHover} onSelect={onSelect} />
      )))}

      {layout.externals.map(({ ext, at }) => (
        <g key={ext.name}>
          <title>{`${ext.name} (${ext.type})\n${ext.detail}${ext.channels.length ? `\nchannels: ${ext.channels.join(", ")}` : ""}`}</title>
          <path d={`M ${at.x + EXT_W / 2} ${at.y} L ${at.x + EXT_W / 2} ${pi.y + piSize.h}`} stroke="#52525b" strokeWidth={0.5} strokeDasharray="1.2 0.8" />
          <rect x={at.x} y={at.y} width={EXT_W} height={EXT_H} rx={1} fill="#18181b" stroke="#52525b" strokeWidth={0.25} />
          <rect x={at.x + 1.2} y={at.y + 1.2} width={8} height={3.2} rx={0.4} fill="#0e7490" />
          <text x={at.x + 5.2} y={at.y + 3.5} fontSize={1.5} textAnchor="middle" fill="#ecfeff" fontWeight={700}>{EXT_ICON[ext.kind]}</text>
          <text x={at.x + 10.5} y={at.y + 3.7} fontSize={1.8} fill="#f4f4f5" fontWeight={600}>{ext.name}</text>
          <text x={at.x + 1.2} y={at.y + 7} fontSize={1.2} fill="#a1a1aa">{ext.detail.length > 48 ? `${ext.detail.slice(0, 47)}…` : ext.detail}</text>
          <text x={at.x + 1.2} y={at.y + 9.3} fontSize={1.2} fill="#71717a">{ext.channels.length ? `${ext.channels.length} channel${ext.channels.length === 1 ? "" : "s"}` : "no channels"}</text>
        </g>
      ))}
    </svg>
  );
});

export default WiringDiagramView;
