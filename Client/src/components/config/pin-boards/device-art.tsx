import React from "react";
import type { DeviceKind, WiringDevice } from "./wiring-model";

// Pictures of the parts on the wiring diagram, in millimetres. A card is
// CARD_W × CARD_H with its wire terminals on one edge: at the bottom for
// parts above a board (Pi), at the top for parts hanging below one (PCA9685).
// The art is drawn for terminals at the bottom and mirrored for the top;
// texts are placed separately so they stay readable.

export const CARD_W = 20;
export const CARD_H = 26;
export type CardSide = "bottom" | "top";
export type TerminalName = "gnd" | "plus" | "sig";

const TERMINAL_X: Record<TerminalName, number> = { gnd: 5, plus: 10, sig: 15 };

/** Terminal of a card at (x, y) in diagram coordinates. */
export function terminalPosition(x: number, y: number, side: CardSide, t: TerminalName) {
  return { x: x + TERMINAL_X[t], y: side === "bottom" ? y + CARD_H : y };
}

/** Which terminals a part has. */
export function terminalsOf(d: WiringDevice): TerminalName[] {
  switch (d.kind) {
    case "servo": case "esc": case "relay": return ["gnd", "plus", "sig"];
    case "button": return d.pin?.pull === "None" ? ["gnd", "plus", "sig"] : ["gnd", "sig"];
    default: return ["gnd", "sig"];
  }
}

/** LED colour from its name: blinker amber, rear/brake red, head/front white … */
export function ledColor(name: string): string {
  const n = name.toLowerCase();
  if (/blink|indicator|turn|amber|orange|gelb|yellow/.test(n)) return "#f59e0b";
  if (/blue|blau|police|polizei/.test(n)) return "#3b82f6";
  if (/green|grün|gruen/.test(n)) return "#22c55e";
  if (/white|weiß|weiss|head|front|scheinwerfer|fern|abblend|work|arbeit/.test(n)) return "#f4f4f5";
  return "#ef4444";
}

export interface ArtState {
  /** LED/relay/buzzer on; brightness 0–1 for PWM LEDs. */
  on?: number;
  /** Servo horn angle in degrees. */
  angle?: number;
  /** Button/input reads 1. */
  active?: boolean;
}

interface Label { x: number; y: number; text: string; size: number; color: string; anchor?: "start" | "middle" | "end" }

const LEAD = "#a1a1aa";
const lead = (d: string, color = LEAD, w = 0.35) => <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" />;

/** Band colours of a resistor value (three bands). */
const BANDS: Record<string, string[]> = {
  "330": ["#f97316", "#f97316", "#78350f"],
  "220": ["#ef4444", "#ef4444", "#78350f"],
  "10k": ["#78350f", "#18181b", "#f97316"],
};

function Resistor({ x, y1, y2, value }: { x: number; y1: number; y2: number; value: keyof typeof BANDS }) {
  const h = y2 - y1;
  return (
    <g>
      <rect x={x - 0.75} y={y1} width={1.5} height={h} rx={0.6} fill="#d6c08f" stroke="#a8925f" strokeWidth={0.15} />
      {BANDS[value].map((c, i) => <rect key={i} x={x - 0.75} y={y1 + h * (0.2 + i * 0.22)} width={1.5} height={h * 0.12} fill={c} />)}
    </g>
  );
}

function art(kind: DeviceKind, d: WiringDevice, s: ArtState): { body: React.ReactNode; labels: Label[] } {
  switch (kind) {
    case "servo": {
      const angle = s.angle ?? 0;
      return {
        body: (
          <g>
            {lead("M 8 16 C 8 20, 3.5 20, 3.5 25", "#78350f", 0.6)}
            {lead("M 8.5 16 L 8.5 25", "#dc2626", 0.6)}
            {lead("M 9 16 C 9 20, 13.5 20, 13.5 25", "#f97316", 0.6)}
            <rect x={0.8} y={8.6} width={15.4} height={2.6} rx={0.4} fill="#1e3a8a" />
            <circle cx={1.8} cy={9.9} r={0.5} fill="#0f172a" /><circle cx={15.2} cy={9.9} r={0.5} fill="#0f172a" />
            <rect x={2.5} y={6} width={12} height={10} rx={0.8} fill="#2563eb" stroke="#1e3a8a" strokeWidth={0.25} />
            <g transform={`rotate(${angle} 6 9.8)`}>
              <rect x={5.3} y={4.2} width={1.4} height={7.4} rx={0.7} fill="#f4f4f5" stroke="#a1a1aa" strokeWidth={0.12} />
            </g>
            <circle cx={6} cy={9.8} r={1.7} fill="#e5e7eb" stroke="#a1a1aa" strokeWidth={0.15} />
            <circle cx={6} cy={9.8} r={0.45} fill="#71717a" />
          </g>
        ),
        labels: [{ x: 11.2, y: 14.8, text: "SERVO", size: 1.25, color: "#dbeafe" }],
      };
    }
    case "esc":
      return {
        body: (
          <g>
            {lead("M 5 14.5 C 5 20, 3.5 20, 3.5 25", "#78350f", 0.6)}
            {lead("M 5.5 14.5 C 5.5 20, 8.5 20, 8.5 25", "#dc2626", 0.6)}
            {lead("M 6 14.5 C 6 20, 13.5 20, 13.5 25", "#f4f4f5", 0.6)}
            {lead("M 9.5 8 L 11 8", "#3b82f6", 0.5)}{lead("M 9.5 9.5 L 11 9.5", "#eab308", 0.5)}{lead("M 9.5 11 L 11 11", "#18181b", 0.5)}
            {lead("M 2 7 L 0.5 4", "#dc2626", 0.6)}{lead("M 2 8.5 L 0.5 6", "#18181b", 0.6)}
            <rect x={1.5} y={5.5} width={8} height={9} rx={1.2} fill="#0369a1" stroke="#0c4a6e" strokeWidth={0.25} />
            <circle cx={13} cy={9.5} r={3.2} fill="#52525b" stroke="#27272a" strokeWidth={0.3} />
            <circle cx={13} cy={9.5} r={1.9} fill="none" stroke="#71717a" strokeWidth={0.25} />
            <circle cx={13} cy={9.5} r={0.6} fill="#d4d4d8" />
          </g>
        ),
        labels: [{ x: 5.5, y: 10.8, text: "ESC", size: 1.8, color: "#e0f2fe" }, { x: 13, y: 14.6, text: "motor", size: 1, color: "#a1a1aa" }],
      };
    case "led": {
      const color = ledColor(d.title);
      const on = s.on ?? 0;
      const onPca = d.endpoint.board === "pca";
      return {
        body: (
          <g>
            {on > 0 && <circle cx={8.5} cy={7.5} r={6.5} fill={color} opacity={0.25 + 0.45 * on} filter="url(#wiring-blur)" />}
            {lead("M 7.3 11 L 7.3 17 C 7.3 21, 3.5 21, 3.5 25")}
            {lead("M 9.7 11 L 9.7 18.6 L 13.5 18.6 L 13.5 25")}
            <Resistor x={13.5} y1={19.6} y2={23.2} value={onPca ? "220" : "330"} />
            <path d="M 6 10 L 6 6.4 A 2.5 2.5 0 0 1 11 6.4 L 11 10 Z" fill={color} opacity={0.35 + 0.65 * Math.max(on, 0.35)} stroke={color} strokeWidth={0.2} />
            <rect x={5.4} y={10} width={6.2} height={1} rx={0.2} fill={color} opacity={0.8} />
            <path d="M 7.6 7 L 9.3 7.4" stroke="#ffffff" strokeWidth={0.3} opacity={0.6} />
          </g>
        ),
        labels: [
          { x: 12.2, y: 22.2, text: onPca ? "220Ω" : "330Ω", size: 1.05, color: "#d6c08f", anchor: "end" },
          { x: 6.6, y: 15.5, text: "−", size: 1.4, color: "#a1a1aa", anchor: "end" },
          { x: 10.3, y: 15.5, text: "+", size: 1.4, color: "#a1a1aa", anchor: "start" },
        ],
      };
    }
    case "relay": {
      const on = (s.on ?? 0) > 0;
      return {
        body: (
          <g>
            {lead("M 3.5 18 L 3.5 25")}{lead("M 8.5 18 L 8.5 25")}{lead("M 13.5 18 L 13.5 25")}
            <rect x={1} y={4.5} width={15} height={14} rx={0.6} fill="#1d4ed8" stroke="#1e3a8a" strokeWidth={0.2} />
            <rect x={2.5} y={6} width={8.5} height={7.5} rx={0.4} fill="#2563eb" stroke="#172554" strokeWidth={0.25} />
            <rect x={12} y={5.5} width={3.4} height={8.5} rx={0.2} fill="#0284c7" />
            {[7, 9.6, 12.2].map(y => <circle key={y} cx={13.7} cy={y} r={0.75} fill="#cbd5e1" stroke="#475569" strokeWidth={0.12} />)}
            <circle cx={3.2} cy={15} r={0.55} fill={on ? "#f87171" : "#7f1d1d"} />
            {[3.5, 8.5, 13.5].map(x => <rect key={x} x={x - 0.5} y={17.4} width={1} height={1} fill="#d4af37" />)}
          </g>
        ),
        labels: [
          { x: 6.75, y: 10.4, text: "RELAY", size: 1.15, color: "#dbeafe" },
          { x: 3.5, y: 16.9, text: "GND", size: 0.8, color: "#dbeafe" },
          { x: 8.5, y: 16.9, text: "VCC", size: 0.8, color: "#dbeafe" },
          { x: 13.5, y: 16.9, text: "IN", size: 0.8, color: "#dbeafe" },
        ],
      };
    }
    case "buzzer": {
      const on = (s.on ?? 0) > 0;
      return {
        body: (
          <g>
            {lead("M 7 15 C 7 20, 3.5 20, 3.5 25")}{lead("M 10 15 C 10 20, 13.5 20, 13.5 25")}
            {on && [7.5, 9.5].map(r => <circle key={r} cx={8.5} cy={10} r={r} fill="none" stroke="#fde047" strokeWidth={0.25} opacity={0.6} />)}
            <circle cx={8.5} cy={10} r={5} fill="#18181b" stroke="#52525b" strokeWidth={0.3} />
            <circle cx={8.5} cy={10} r={1.1} fill="#27272a" stroke="#3f3f46" strokeWidth={0.2} />
          </g>
        ),
        labels: [{ x: 11.2, y: 8, text: "+", size: 1.5, color: "#a1a1aa" }],
      };
    }
    case "button": {
      const pressed = !!s.active;
      const pull = d.pin?.pull ?? "None";
      return {
        body: (
          <g>
            {lead("M 5 13.5 L 5 18 C 5 21, 3.5 21, 3.5 25")}
            {lead("M 12 13.5 L 12 17 C 12 19, 13.5 20, 13.5 25")}
            {pull === "None" && <>{lead("M 12 16.5 L 8.5 16.5 L 8.5 25")}<Resistor x={8.5} y1={18.2} y2={22.2} value="10k" /></>}
            <rect x={4.5} y={6} width={8} height={8} rx={0.5} fill="#27272a" stroke="#52525b" strokeWidth={0.25} />
            {[[5.4, 6.9], [11.6, 6.9], [5.4, 13.1], [11.6, 13.1]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={0.35} fill="#71717a" />)}
            <circle cx={8.5} cy={10} r={2.7} fill={pressed ? "#fde047" : "#3f3f46"} stroke="#18181b" strokeWidth={0.3} />
          </g>
        ),
        labels: pull === "None" ? [{ x: 7.6, y: 21, text: "10k", size: 1, color: "#d6c08f", anchor: "end" }] : [],
      };
    }
    default: {
      const input = kind === "input";
      return {
        body: (
          <g>
            {lead("M 6 16 C 6 20, 3.5 20, 3.5 25")}{lead("M 11 16 C 11 20, 13.5 20, 13.5 25")}
            <rect x={3} y={6} width={11} height={10} rx={1} fill="#3f3f46" stroke="#71717a" strokeWidth={0.25} />
            {(s.on ?? 0) > 0 || s.active ? <circle cx={12.2} cy={7.8} r={0.7} fill="#fde047" /> : null}
          </g>
        ),
        labels: [{ x: 8.5, y: 11.8, text: input ? "IN" : "OUT", size: 1.8, color: "#e4e4e7" }],
      };
    }
  }
}

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface DeviceCardProps {
  device: WiringDevice;
  x: number;
  y: number;
  side: CardSide;
  subtitle: string;
  state: ArtState;
  highlighted: boolean;
  dimmed: boolean;
  onHover: (id: string | undefined) => void;
  onSelect: (id: string) => void;
}

export function DeviceCard({ device, x, y, side, subtitle, state, highlighted, dimmed, onHover, onSelect }: DeviceCardProps) {
  const { body, labels } = art(device.kind, device, state);
  const flip = side === "top";
  const artTransform = flip ? `translate(${x + 1.5} ${y + 25}) scale(1 -1)` : `translate(${x + 1.5} ${y + 1})`;
  const ly = (artY: number, size: number) => (flip ? y + 25 - artY + size * 0.7 : y + 1 + artY);
  const titleY = flip ? y + CARD_H - 2.6 : y + 3;
  const subY = flip ? y + CARD_H - 0.9 : y + 4.7;
  const hasProblem = device.notes.some(n => n.startsWith("Configured, but"));
  return (
    <g role="button" tabIndex={0} aria-label={device.title} style={{ cursor: "pointer", outline: "none" }} opacity={dimmed ? 0.35 : 1}
      onPointerEnter={() => onHover(device.id)} onPointerLeave={() => onHover(undefined)} onClick={() => onSelect(device.id)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(device.id); } }}>
      <title>{[device.title, subtitle, ...device.controls.map(c => `control: ${c}`), ...device.readers.map(r => `telemetry: ${r.name}`), ...device.notes].join("\n")}</title>
      <rect x={x} y={y} width={CARD_W} height={CARD_H} rx={1.2} fill="#18181b" fillOpacity={0.92}
        stroke={highlighted ? "#e4e4e7" : hasProblem ? "#a16207" : "#3f3f46"} strokeWidth={highlighted ? 0.4 : 0.25} strokeDasharray={hasProblem ? "1 0.6" : undefined} />
      <g transform={artTransform}>{body}</g>
      {labels.map((l, i) => (
        <text key={i} x={x + 1.5 + l.x} y={ly(l.y, l.size)} fontSize={l.size} fill={l.color} textAnchor={l.anchor ?? "middle"} fontWeight={600} pointerEvents="none">{l.text}</text>
      ))}
      <text x={x + CARD_W / 2} y={titleY} fontSize={1.9} fill="#f4f4f5" textAnchor="middle" fontWeight={600} pointerEvents="none">{shorten(device.title, 15)}</text>
      <text x={x + CARD_W / 2} y={subY} fontSize={1.25} fill="#a1a1aa" textAnchor="middle" pointerEvents="none">{shorten(subtitle, 26)}</text>
    </g>
  );
}

/** Power supply box (BEC / battery) with + and − terminals at the bottom. */
export const SUPPLY_W = 22;
export const SUPPLY_H = 11;
export const supplyTerminal = (x: number, y: number, t: "plus" | "minus") => ({ x: x + (t === "plus" ? 6 : 16), y: y + SUPPLY_H });

export function SupplyBox({ x, y, title, sub }: { x: number; y: number; title: string; sub: string }) {
  return (
    <g>
      <title>{`${title}\n${sub}`}</title>
      <rect x={x} y={y} width={SUPPLY_W} height={SUPPLY_H} rx={1} fill="#1c1917" stroke="#b45309" strokeWidth={0.3} />
      <rect x={x + 1.2} y={y + 1.2} width={5} height={3} rx={0.3} fill="#b45309" opacity={0.7} />
      <text x={x + 3.7} y={y + 3.3} fontSize={1.5} textAnchor="middle" fill="#fef3c7" fontWeight={700}>⚡</text>
      <text x={x + 7.5} y={y + 3.6} fontSize={1.7} fill="#fde68a" fontWeight={600}>{title}</text>
      <text x={x + 1.2} y={y + 6.6} fontSize={1.2} fill="#d6d3d1">{sub}</text>
      <text x={x + 6} y={y + 9.8} fontSize={1.6} fill="#f87171" textAnchor="middle" fontWeight={700}>+</text>
      <text x={x + 16} y={y + 9.8} fontSize={1.6} fill="#a1a1aa" textAnchor="middle" fontWeight={700}>−</text>
    </g>
  );
}
