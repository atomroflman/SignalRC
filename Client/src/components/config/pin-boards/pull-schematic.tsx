import React, { useState } from "react";
import { inputLevel, nearestPin, PI_HEADER, type GpioPull } from "./pin-boards";

// Small schematic next to the pull resistor choice. Up/Down: the resistor
// inside the SoC (≈50 kΩ, switched by the pin config) and the switch the user
// wires to GND or 3.3 V. None: nothing inside, so the resistor has to be
// external (10 kΩ shown as pull-up). The switch is clickable and shows the
// level and the logical value (activeLow applied) the GpioPinReader reports.

const WIRE = "#a1a1aa";
const INTERNAL = "#67e8f9";
const EXTERNAL = "#fbbf24";
const HIGH = "#f87171";
const LOW = "#60a5fa";

/** Vertical resistor between y1 and y2 at x (zigzag). */
function Resistor({ x, y1, y2, color, label, labelSide = "right" }: { x: number; y1: number; y2: number; color: string; label: string; labelSide?: "left" | "right" }) {
  const top = y1 + 6, bottom = y2 - 6, steps = 6, h = (bottom - top) / steps;
  const zig = Array.from({ length: steps }, (_, i) => `L ${x + (i % 2 === 0 ? 5 : -5)} ${top + h * (i + 0.5)}`).join(" ");
  return (
    <g>
      <path d={`M ${x} ${y1} L ${x} ${top} ${zig} L ${x} ${bottom} L ${x} ${y2}`} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <text x={labelSide === "right" ? x + 9 : x - 9} y={(y1 + y2) / 2 + 3} fontSize={8} fill={color} textAnchor={labelSide === "right" ? "start" : "end"}>{label}</text>
    </g>
  );
}

function Ground({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g stroke={color} strokeWidth={1.6}>
      <line x1={x} y1={y - 6} x2={x} y2={y} />
      <line x1={x - 8} y1={y} x2={x + 8} y2={y} />
      <line x1={x - 5} y1={y + 3} x2={x + 5} y2={y + 3} />
      <line x1={x - 2} y1={y + 6} x2={x + 2} y2={y + 6} />
    </g>
  );
}

function Rail({ x, y, color, label }: { x: number; y: number; color: string; label: string }) {
  return (
    <g>
      <line x1={x - 9} y1={y} x2={x + 9} y2={y} stroke={color} strokeWidth={1.6} />
      <text x={x} y={y - 4} fontSize={8} fill={color} textAnchor="middle">{label}</text>
    </g>
  );
}

/** Vertical switch between y1 (top) and y2 (bottom); clickable. */
function Switch({ x, y1, y2, closed, onToggle, color }: { x: number; y1: number; y2: number; closed: boolean; onToggle: () => void; color: string }) {
  const a = y1 + 14, b = y2 - 14;
  return (
    <g role="button" tabIndex={0} aria-pressed={closed} aria-label="Switch" style={{ cursor: "pointer" }}
      onClick={onToggle} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
      <rect x={x - 16} y={y1} width={32} height={y2 - y1} fill="transparent" />
      <line x1={x} y1={y1} x2={x} y2={a} stroke={color} strokeWidth={1.6} />
      <line x1={x} y1={b} x2={x} y2={y2} stroke={color} strokeWidth={1.6} />
      <circle cx={x} cy={a} r={2} fill={color} />
      <circle cx={x} cy={b} r={2} fill={color} />
      <line x1={x} y1={b} x2={closed ? x : x + 11} y2={closed ? a : a + 3} stroke={EXTERNAL} strokeWidth={2} strokeLinecap="round" />
      <text x={x + 13} y={(a + b) / 2 + 3} fontSize={7} fill="#71717a">{closed ? "closed" : "open"}</text>
    </g>
  );
}

export default function PullSchematic({ physical, pull, activeLow }: { physical: number; pull: GpioPull; activeLow: boolean }) {
  const [closed, setClosed] = useState(false);
  const pin = PI_HEADER[physical - 1];
  const gnd = nearestPin(physical, "gnd");
  const v33 = nearestPin(physical, "3v3");
  const level = inputLevel(pull, closed);
  const logical = (level === "HIGH") !== activeLow;
  const node = level === "HIGH" ? HIGH : LOW;
  const toggle = () => setClosed(c => !c);
  const NODE_Y = 66;

  return (
    <div className="rounded border border-zinc-700 bg-zinc-950 p-1.5 text-[10px] text-zinc-400">
      <svg viewBox="0 0 250 132" className="w-[250px] max-w-full h-auto select-none" role="img" aria-label={`Wiring for ${pull === "None" ? "no internal pull resistor" : `internal pull-${pull.toLowerCase()}`}`}>
        {/* SoC boundary */}
        <rect x={4} y={4} width={96} height={124} rx={4} fill="#18181b" stroke="#52525b" strokeDasharray="4 3" />
        <text x={10} y={15} fontSize={8} fill="#a1a1aa">SoC (inside the Pi)</text>
        {/* Input buffer, reading the pad */}
        <path d="M 52 58 L 52 74 L 38 66 Z" fill="none" stroke={WIRE} strokeWidth={1.4} />
        <line x1={28} y1={NODE_Y} x2={38} y2={NODE_Y} stroke={WIRE} strokeWidth={1.4} />
        <text x={12} y={86} fontSize={7} fill="#71717a">reads {level}</text>
        <line x1={52} y1={NODE_Y} x2={100} y2={NODE_Y} stroke={node} strokeWidth={1.8} />
        <circle cx={78} cy={NODE_Y} r={2.2} fill={node} />

        {pull === "Up" && (<><Rail x={78} y={26} color={INTERNAL} label="3.3 V" /><Resistor x={78} y1={26} y2={NODE_Y} color={INTERNAL} label="≈50k" labelSide="left" /></>)}
        {pull === "Down" && (<><Resistor x={78} y1={NODE_Y} y2={106} color={INTERNAL} label="≈50k" labelSide="left" /><Ground x={78} y={112} color={INTERNAL} /></>)}
        {pull === "None" && <text x={60} y={118} fontSize={7} fill="#f87171" textAnchor="middle">no internal resistor</text>}

        {/* Header pin */}
        <rect x={96} y={NODE_Y - 4} width={8} height={8} fill="#d4af37" stroke="#71717a" />
        <text x={108} y={NODE_Y - 7} fontSize={8} fill="#e4e4e7">Pin {physical}</text>
        <text x={108} y={NODE_Y + 13} fontSize={7} fill="#71717a">{pin?.label}</text>

        {/* External wiring */}
        {pull === "Down" ? (
          <>
            <line x1={104} y1={NODE_Y} x2={200} y2={NODE_Y} stroke={node} strokeWidth={1.8} />
            <Rail x={200} y={20} color={EXTERNAL} label={`Pin ${v33?.physical} · 3.3 V`} />
            <Switch x={200} y1={20} y2={NODE_Y} closed={closed} onToggle={toggle} color={EXTERNAL} />
          </>
        ) : (
          <>
            <line x1={104} y1={NODE_Y} x2={200} y2={NODE_Y} stroke={node} strokeWidth={1.8} />
            <Switch x={200} y1={NODE_Y} y2={112} closed={closed} onToggle={toggle} color={EXTERNAL} />
            <Ground x={200} y={118} color={EXTERNAL} />
            <text x={188} y={127} fontSize={7} fill={EXTERNAL} textAnchor="end">Pin {gnd?.physical} · GND</text>
            {pull === "None" && (
              <>
                <circle cx={160} cy={NODE_Y} r={2.2} fill={node} />
                <Rail x={160} y={20} color={EXTERNAL} label={`Pin ${v33?.physical} · 3.3 V`} />
                <Resistor x={160} y1={20} y2={NODE_Y} color={EXTERNAL} label="10k" labelSide="left" />
              </>
            )}
          </>
        )}
      </svg>
      <div className="mt-0.5 leading-snug">
        <span className="text-zinc-300">Switch {closed ? "closed" : "open"}</span>: pin {level} → reports <span className={logical ? "text-yellow-200" : "text-zinc-300"}>{logical ? "1" : "0"}</span>{activeLow ? " (active low)" : ""}. Click the switch.
      </div>
      <div className="leading-snug text-zinc-500">
        {pull === "Up" && `Wire the switch between pin ${physical} and GND (e.g. pin ${gnd?.physical}). Use “active low” so pressed = 1.`}
        {pull === "Down" && `Wire the switch between pin ${physical} and 3.3 V (pin ${v33?.physical}). Never 5 V.`}
        {pull === "None" && `Without an internal pull the pin floats: add 10 kΩ to 3.3 V (pin ${v33?.physical}) and switch to GND - or 10 kΩ to GND and switch to 3.3 V. Also for sensors with push-pull output, which need none.`}
      </div>
    </div>
  );
}
