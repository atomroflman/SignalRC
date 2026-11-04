import React from "react";
import { PCA_CHANNELS, pcaJumpers } from "./pin-boards";

// The common 16-channel PCA9685 servo breakout (Adafruit layout and its
// clones), top view in millimetres: 16 servo columns PWM / V+ / GND in four
// groups along the bottom, control headers on both short sides, the V+ screw
// terminal at the top and the address jumpers A0 … A5.

export interface PcaChannelVisual {
  used?: boolean;
  /** Live duty cycle 0–1 from a PwmOutputReader channel. */
  duty?: number;
  fault?: boolean;
}

export type PcaHoverTarget =
  | { kind: "channel"; channel: number; row: "pwm" | "v+" | "gnd" }
  | { kind: "control"; pin: string }
  | { kind: "jumper"; bit: number }
  | { kind: "terminal"; pin: "V+" | "GND" };

export interface PcaBoardProps {
  channels: Record<number, PcaChannelVisual>;
  selected?: number;
  boardAddress: number;
  onSelect: (channel: number) => void;
  onToggleJumper: (bit: number) => void;
  onHover: (target: PcaHoverTarget | undefined, event?: React.PointerEvent) => void;
  /** Embedded in a larger SVG: board origin at this point, 1 unit = 1 mm. */
  at?: { x: number; y: number };
}

const PITCH = 2.54;
export const PCA_W = 62.2;
export const PCA_H = 25.4;
export const ROW_Y = { pwm: 17.2, "v+": 19.74, gnd: 22.28 } as const;
const W = PCA_W;
const H = PCA_H;
export const CONTROL_PINS = ["GND", "OE", "SCL", "SDA", "VCC", "V+"] as const;

/** Centre of a control header pin; side "left" or "right". */
export const controlPinPosition = (side: "left" | "right", name: (typeof CONTROL_PINS)[number]) =>
  ({ x: side === "left" ? 2.2 : W - 2.2, y: 6.17 + CONTROL_PINS.indexOf(name) * PITCH });

/** x centre of a servo column; a gap of one pitch between the groups of four. */
export function channelX(channel: number) {
  const group = Math.floor(channel / 4);
  const start = (W - (PCA_CHANNELS + 3) * PITCH) / 2 + PITCH / 2;
  return start + (channel + group) * PITCH;
}

const ROW_COLORS = { pwm: "#facc15", "v+": "#ef4444", gnd: "#27272a" } as const;

export default function Pca9685Board({ channels, selected, boardAddress, onSelect, onToggleJumper, onHover, at }: PcaBoardProps) {
  const jumpers = pcaJumpers(boardAddress);
  const hover = (t: PcaHoverTarget) => ({
    onPointerEnter: (e: React.PointerEvent) => onHover(t, e),
    onPointerMove: (e: React.PointerEvent) => onHover(t, e),
    onPointerLeave: () => onHover(undefined),
  });
  return (
    <svg viewBox={`-2 -3 ${W + 4} ${H + 5}`} role="group" aria-label="PCA9685 16-channel PWM board"
      {...(at ? { x: at.x - 2, y: at.y - 3, width: W + 4, height: H + 5, overflow: "visible" } : { className: "w-full h-auto select-none" })}>
      <defs>
        <linearGradient id="pca-pcb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e3a8a" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect x={0} y={0} width={W} height={H} rx={1.5} fill="url(#pca-pcb)" stroke="#172554" strokeWidth={0.3} />
      {[[2.5, 2.5], [W - 2.5, 2.5], [2.5, H - 2.5], [W - 2.5, H - 2.5]].map(([x, y]) => (
        <g key={`${x}-${y}`}><circle cx={x} cy={y} r={1.9} fill="#d4af37" opacity={0.5} /><circle cx={x} cy={y} r={1.25} fill="#09090b" /></g>
      ))}

      {/* PCA9685 TSSOP-28 */}
      <rect x={27} y={6} width={8} height={5} rx={0.3} fill="#18181b" stroke="#52525b" strokeWidth={0.15} />
      {Array.from({ length: 14 }, (_, i) => (
        <g key={i}>
          <rect x={27.3 + i * 0.53} y={5.4} width={0.25} height={0.6} fill="#a1a1aa" />
          <rect x={27.3 + i * 0.53} y={11} width={0.25} height={0.6} fill="#a1a1aa" />
        </g>
      ))}
      <text x={31} y={8.9} fontSize={1.1} textAnchor="middle" fill="#a1a1aa">PCA9685</text>
      <circle cx={21} cy={9} r={0.7} fill="#ef4444" opacity={0.9} /><text x={21} y={11.2} fontSize={0.9} textAnchor="middle" fill="#e0e7ff">PWR</text>

      {/* V+ screw terminal */}
      <g {...hover({ kind: "terminal", pin: "V+" })}>
        <rect x={10} y={-1.5} width={5} height={6} rx={0.4} fill="#0369a1" stroke="#082f49" strokeWidth={0.2} />
        <circle cx={12.5} cy={1.5} r={1.4} fill="#cbd5e1" stroke="#475569" strokeWidth={0.2} />
        <text x={12.5} y={6.4} fontSize={1} textAnchor="middle" fill="#e0e7ff">V+</text>
      </g>
      <g {...hover({ kind: "terminal", pin: "GND" })}>
        <rect x={15} y={-1.5} width={5} height={6} rx={0.4} fill="#0369a1" stroke="#082f49" strokeWidth={0.2} />
        <circle cx={17.5} cy={1.5} r={1.4} fill="#cbd5e1" stroke="#475569" strokeWidth={0.2} />
        <text x={17.5} y={6.4} fontSize={1} textAnchor="middle" fill="#e0e7ff">GND</text>
      </g>

      {/* Address jumpers A0 … A5 */}
      <text x={45.5} y={2.3} fontSize={1} textAnchor="middle" fill="#e0e7ff">ADDR (bridged = 1)</text>
      {jumpers.map((on, bit) => {
        const x = 52 - bit * 2.6;
        return (
          <g key={bit} role="button" tabIndex={0} aria-label={`Jumper A${bit}`} aria-pressed={on} style={{ cursor: "pointer" }}
            onClick={() => onToggleJumper(bit)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleJumper(bit); } }}
            {...hover({ kind: "jumper", bit })}>
            <rect x={x - 1.1} y={3} width={2.2} height={3.2} fill="transparent" />
            <rect x={x - 0.9} y={3.2} width={0.7} height={1.4} fill="#d4af37" />
            <rect x={x + 0.2} y={3.2} width={0.7} height={1.4} fill="#d4af37" />
            {on && <rect x={x - 0.6} y={3.4} width={1.2} height={1} rx={0.3} fill="#e5e7eb" />}
            <text x={x} y={6.1} fontSize={0.9} textAnchor="middle" fill={on ? "#fde047" : "#e0e7ff"}>A{bit}</text>
          </g>
        );
      })}

      {/* Control headers left and right (same signals on both sides, for chaining) */}
      {[2.2, W - 2.2].map(x => (
        <g key={x}>
          <rect x={x - 1.3} y={4.9} width={2.6} height={6 * PITCH} fill="#09090b" />
          {CONTROL_PINS.map((name, i) => {
            const y = 6.17 + i * PITCH;
            return (
              <g key={name} {...hover({ kind: "control", pin: name })}>
                <rect x={x - 1.27} y={y - 1.27} width={PITCH} height={PITCH} fill="transparent" />
                <circle cx={x} cy={y} r={0.75} fill="#d4af37" stroke={name === "GND" ? "#52525b" : name === "V+" ? "#ef4444" : name === "VCC" ? "#f59e0b" : "#a855f7"} strokeWidth={0.35} />
                <text x={x < W / 2 ? x + 2 : x - 2} y={y + 0.4} fontSize={1} textAnchor={x < W / 2 ? "start" : "end"} fill="#e0e7ff">{name}</text>
              </g>
            );
          })}
        </g>
      ))}

      {/* Servo columns */}
      {(["pwm", "v+", "gnd"] as const).map(row => (
        <text key={row} x={(channelX(7) + channelX(8)) / 2} y={ROW_Y[row] + 0.35} fontSize={0.8} textAnchor="middle" fill="#e0e7ff">{row.toUpperCase()}</text>
      ))}
      {Array.from({ length: PCA_CHANNELS }, (_, ch) => {
        const x = channelX(ch);
        const v = channels[ch] ?? {};
        const isSel = selected === ch;
        return (
          <g key={ch} role="button" tabIndex={0} aria-label={`Channel ${ch}`} aria-pressed={isSel} style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onSelect(ch)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(ch); } }}>
            <text x={x} y={15.2} fontSize={1.1} textAnchor="middle" fill={v.used ? "#7dd3fc" : "#e0e7ff"} fontWeight={v.used ? 700 : 400} pointerEvents="none">{ch}</text>
            <rect x={x - 1.2} y={ROW_Y.pwm - 1.27} width={2.4} height={3 * PITCH} rx={0.2} fill="#09090b" />
            {(["pwm", "v+", "gnd"] as const).map(row => (
              <g key={row} {...hover({ kind: "channel", channel: ch, row })}>
                <rect x={x - 1.27} y={ROW_Y[row] - 1.27} width={PITCH} height={PITCH} fill="transparent" />
                <rect x={x - 0.4} y={ROW_Y[row] - 0.4} width={0.8} height={0.8} fill="#d4af37" stroke={ROW_COLORS[row]} strokeWidth={0.3} />
              </g>
            ))}
            {v.duty !== undefined && (
              <rect x={x - 1.1} y={25.1 - 1.2 * Math.min(1, Math.max(0, v.duty))} width={2.2} height={1.2 * Math.min(1, Math.max(0, v.duty))} fill="#fde047" opacity={0.85} pointerEvents="none" />
            )}
            {v.fault && <circle cx={x} cy={13.4} r={0.45} fill="#f87171" pointerEvents="none" />}
            {isSel && <rect x={x - 1.45} y={13.9} width={2.9} height={10.6} rx={0.5} fill="none" stroke="#ffffff" strokeWidth={0.3} pointerEvents="none" />}
          </g>
        );
      })}
    </svg>
  );
}
