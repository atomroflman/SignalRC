import React from "react";
import { PI_HEADER, PIN_COLORS, isUsableGpio, type HeaderPin, type PiBoardVariant } from "./pin-boards";

// Top view of a Raspberry Pi in millimetres (official mechanical drawings),
// header along the top edge: even pins (2 … 40) on the board edge, odd pins
// (1 … 39) towards the middle, pin 1 square at the left.

export interface PinVisual {
  /** Configured mode, shown as a badge letter. */
  mode?: "Output" | "Input" | "Pwm";
  /** At least one channel uses the pin. */
  used?: boolean;
  /** Live logical level from a telemetry channel; undefined = none. */
  live?: boolean;
  /** Configuration problem. */
  problem?: boolean;
}

export interface PiBoardProps {
  variant: PiBoardVariant;
  pins: Record<number, PinVisual>;
  selected?: number;
  /** Pins of interfaces another pin manager uses (e.g. I²C 3/5 for a PCA9685). */
  busy?: Record<number, string>;
  onSelect: (pin: number) => void;
  onHover: (pin: HeaderPin | undefined, event?: React.PointerEvent) => void;
}

const PITCH = 2.54;

interface Size { w: number; h: number; headerX: number; headerY: number; }

const SIZES: Record<PiBoardVariant, Size> = {
  pi5: { w: 85, h: 56, headerX: 32.5, headerY: 3.5 },
  pi4: { w: 85, h: 56, headerX: 32.5, headerY: 3.5 },
  pi3: { w: 85, h: 56, headerX: 32.5, headerY: 3.5 },
  pi3a: { w: 65, h: 56, headerX: 32.5, headerY: 3.5 },
  zero: { w: 65, h: 30, headerX: 32.5, headerY: 3.5 },
  pi400: { w: 120, h: 44, headerX: 30, headerY: 4.5 },
  generic: { w: 60, h: 12, headerX: 30, headerY: 5 },
};

/** Centre of a header pin in board millimetres. */
export function pinPosition(variant: PiBoardVariant, physical: number) {
  const s = SIZES[variant];
  const col = Math.ceil(physical / 2) - 1;
  const x = s.headerX + (col - 9.5) * PITCH;
  const y = s.headerY + (physical % 2 === 0 ? -PITCH / 2 : PITCH / 2);
  return { x, y };
}

// --- decorations -----------------------------------------------------------

const metal = "url(#rpi-metal)";
const Port = ({ x, y, w, h, label, fill = metal, rx = 0.4 }: { x: number; y: number; w: number; h: number; label?: string; fill?: string; rx?: number }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={rx} fill={fill} stroke="#3f3f46" strokeWidth={0.2} />
    {label && <text x={x + w / 2} y={y + h / 2 + 0.6} fontSize={1.6} textAnchor="middle" fill="#18181b" fontWeight={600}>{label}</text>}
  </g>
);
const Chip = ({ x, y, s, label, sub }: { x: number; y: number; s: number; label: string; sub?: string }) => (
  <g>
    <rect x={x} y={y} width={s} height={s} rx={0.6} fill="#27272a" stroke="#52525b" strokeWidth={0.2} />
    <rect x={x + 0.6} y={y + 0.6} width={s - 1.2} height={s - 1.2} rx={0.4} fill="none" stroke="#3f3f46" strokeWidth={0.15} />
    <text x={x + s / 2} y={y + s / 2 + (sub ? -0.2 : 0.5)} fontSize={1.4} textAnchor="middle" fill="#a1a1aa">{label}</text>
    {sub && <text x={x + s / 2} y={y + s / 2 + 1.6} fontSize={1} textAnchor="middle" fill="#71717a">{sub}</text>}
  </g>
);
const Ffc = ({ x, y, w, h, label }: { x: number; y: number; w: number; h: number; label: string }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx={0.2} fill="#e4e4e7" stroke="#71717a" strokeWidth={0.15} />
    <rect x={x + 0.3} y={y + 0.3} width={w - 0.6} height={Math.min(1, h - 0.6)} fill="#a16207" opacity={0.8} />
    <text x={x + w / 2} y={y + h + 1.7} fontSize={1.2} textAnchor="middle" fill="#d4d4d8">{label}</text>
  </g>
);
const Hole = ({ x, y }: { x: number; y: number }) => (
  <g>
    <circle cx={x} cy={y} r={3} fill="#d4af37" opacity={0.5} />
    <circle cx={x} cy={y} r={1.375} fill="#09090b" />
  </g>
);
const Silk = ({ x, y, children, size = 1.6, anchor = "start" }: { x: number; y: number; children: React.ReactNode; size?: number; anchor?: "start" | "middle" | "end" }) => (
  <text x={x} y={y} fontSize={size} fill="#f4f4f5" opacity={0.85} textAnchor={anchor} fontFamily="ui-sans-serif, system-ui">{children}</text>
);

function Decorations({ variant }: { variant: PiBoardVariant }) {
  switch (variant) {
    case "pi5":
      return (
        <g>
          <Hole x={3.5} y={3.5} /><Hole x={61.5} y={3.5} /><Hole x={3.5} y={52.5} /><Hole x={61.5} y={52.5} />
          <Chip x={24} y={20} s={14} label="BCM2712" sub="SoC" />
          <rect x={40} y={21} width={10} height={12} rx={0.5} fill="#18181b" stroke="#3f3f46" strokeWidth={0.2} />
          <text x={45} y={27.6} fontSize={1.3} textAnchor="middle" fill="#a1a1aa">LPDDR4X</text>
          <Chip x={53} y={30} s={8} label="RP1" sub="I/O" />
          <Port x={6.5} y={50} w={9} h={7.5} label="USB-C" rx={1.4} />
          <Port x={21.5} y={50.5} w={7} h={6.5} label="HDMI0" />
          <Port x={34.5} y={50.5} w={7} h={6.5} label="HDMI1" />
          <Ffc x={44} y={45} w={7} h={2.5} label="CAM/DISP 0" />
          <Ffc x={53} y={45} w={7} h={2.5} label="CAM/DISP 1" />
          <Port x={69} y={2} w={18} h={13.5} label="USB 2.0" fill="#e4e4e7" />
          <Port x={69} y={20} w={18} h={13.5} label="USB 3.0" fill="#93c5fd" />
          <Port x={66} y={38} w={21} h={16} label="Ethernet" />
          <Ffc x={0.5} y={18} w={2.5} h={12} label="" />
          <Silk x={1.5} y={34} size={1.1}>PCIe</Silk>
          <rect x={5} y={14} width={4} height={2} rx={0.3} fill="#e4e4e7" /><Silk x={7} y={18.2} size={1} anchor="middle">FAN</Silk>
          <circle cx={4} cy={44} r={1.2} fill="#d4d4d8" stroke="#71717a" strokeWidth={0.2} /><Silk x={6} y={44.5} size={1}>PWR</Silk>
          <Silk x={12} y={40}>Raspberry Pi 5</Silk>
        </g>
      );
    case "pi4":
      return (
        <g>
          <Hole x={3.5} y={3.5} /><Hole x={61.5} y={3.5} /><Hole x={3.5} y={52.5} /><Hole x={61.5} y={52.5} />
          <Chip x={22} y={20} s={15} label="BCM2711" sub="SoC" />
          <rect x={40} y={21} width={10} height={13} rx={0.5} fill="#18181b" stroke="#3f3f46" strokeWidth={0.2} />
          <text x={45} y={28} fontSize={1.3} textAnchor="middle" fill="#a1a1aa">LPDDR4</text>
          <Port x={6.5} y={50} w={9} h={7.5} label="USB-C" rx={1.4} />
          <Port x={22.5} y={50.5} w={7} h={6.5} label="HDMI0" />
          <Port x={36} y={50.5} w={7} h={6.5} label="HDMI1" />
          <circle cx={53.5} cy={53.5} r={3} fill="#18181b" stroke="#52525b" strokeWidth={0.3} />
          <Ffc x={44} y={41} w={2.5} h={7} label="" /><Silk x={45.2} y={40.5} size={1} anchor="middle">CAM</Silk>
          <Ffc x={1} y={16} w={2.5} h={14} label="" /><Silk x={5} y={24} size={1}>DISPLAY</Silk>
          <Port x={66} y={2} w={21} h={16} label="Ethernet" />
          <Port x={69} y={21} w={18} h={13.5} label="USB 2.0" fill="#e4e4e7" />
          <Port x={69} y={39.5} w={18} h={13.5} label="USB 3.0" fill="#93c5fd" />
          <Silk x={10} y={40}>Raspberry Pi 4 Model B</Silk>
        </g>
      );
    case "pi3":
      return (
        <g>
          <Hole x={3.5} y={3.5} /><Hole x={61.5} y={3.5} /><Hole x={3.5} y={52.5} /><Hole x={61.5} y={52.5} />
          <Chip x={22} y={20} s={14} label="BCM2837" sub="SoC" />
          <Chip x={56} y={36} s={7} label="LAN" />
          <Port x={7} y={51} w={8} h={5.5} label="µUSB" rx={1} />
          <Port x={24.5} y={48.5} w={15} h={8.5} label="HDMI" />
          <circle cx={53.5} cy={53.5} r={3} fill="#18181b" stroke="#52525b" strokeWidth={0.3} />
          <Ffc x={44} y={41} w={2.5} h={7} label="" /><Silk x={45.2} y={40.5} size={1} anchor="middle">CAM</Silk>
          <Ffc x={1} y={16} w={2.5} h={14} label="" /><Silk x={5} y={24} size={1}>DISPLAY</Silk>
          <Port x={69} y={2} w={18} h={13.5} label="USB" fill="#e4e4e7" />
          <Port x={69} y={20} w={18} h={13.5} label="USB" fill="#e4e4e7" />
          <Port x={66} y={38} w={21} h={16} label="Ethernet" />
          <Silk x={10} y={40}>Raspberry Pi Model B</Silk>
        </g>
      );
    case "pi3a":
      return (
        <g>
          <Hole x={3.5} y={3.5} /><Hole x={61.5} y={3.5} /><Hole x={3.5} y={52.5} /><Hole x={61.5} y={52.5} />
          <Chip x={22} y={20} s={14} label="BCM2837B0" sub="SoC" />
          <Port x={7} y={51} w={8} h={5.5} label="µUSB" rx={1} />
          <Port x={24.5} y={48.5} w={15} h={8.5} label="HDMI" />
          <circle cx={53.5} cy={53.5} r={3} fill="#18181b" stroke="#52525b" strokeWidth={0.3} />
          <Port x={52} y={20} w={15} h={13.5} label="USB" fill="#e4e4e7" />
          <Ffc x={44} y={41} w={2.5} h={7} label="" /><Silk x={45.2} y={40.5} size={1} anchor="middle">CAM</Silk>
          <Silk x={10} y={40}>Raspberry Pi 3 Model A+</Silk>
        </g>
      );
    case "zero":
      return (
        <g>
          <Hole x={3.5} y={3.5} /><Hole x={61.5} y={3.5} /><Hole x={3.5} y={26.5} /><Hole x={61.5} y={26.5} />
          <Chip x={26} y={11} s={11} label="RP3A0" sub="SiP" />
          <Port x={-1.5} y={11} w={12} h={11} label="µSD" fill="#a1a1aa" />
          <Port x={8} y={25} w={11} h={4.5} label="mini-HDMI" />
          <Port x={39} y={25.5} w={8} h={4} label="USB" rx={1} />
          <Port x={51.5} y={25.5} w={8} h={4} label="PWR" rx={1} />
          <Ffc x={63} y={9} w={2.5} h={12} label="" /><Silk x={62} y={15.5} size={1} anchor="end">CAM</Silk>
          <Silk x={12} y={9.8}>Raspberry Pi Zero</Silk>
        </g>
      );
    case "pi400":
      return (
        <g>
          <rect x={0} y={9} width={120} height={35} rx={2} fill="#f4f4f5" />
          {Array.from({ length: 5 }, (_, row) => Array.from({ length: 15 }, (_, col) => (
            <rect key={`${row}-${col}`} x={6 + col * 7.2 + (row % 2) * 1.5} y={13 + row * 6} width={6.2} height={5} rx={0.8} fill="#ffffff" stroke="#d4d4d8" strokeWidth={0.2} />
          )))}
          <Port x={60} y={0.5} w={7} h={4} label="µSD" fill="#a1a1aa" />
          <Port x={70} y={0.5} w={6} h={4} label="HDMI" />
          <Port x={78} y={0.5} w={6} h={4} label="HDMI" />
          <Port x={86} y={0.5} w={7} h={4} label="USB-C" rx={1} />
          <Port x={95} y={0.5} w={6} h={4} label="USB" fill="#e4e4e7" />
          <Port x={103} y={0.5} w={6} h={4} label="USB" fill="#93c5fd" />
          <Port x={111} y={0.5} w={8} h={4} label="LAN" />
          <Silk x={60} y={8} size={1.4}>Rear edge, header seen from above - check pin 1 on the device</Silk>
        </g>
      );
    default:
      return <Silk x={30} y={11} size={1.3} anchor="middle">40-pin header (Raspberry Pi)</Silk>;
  }
}

// --- the board --------------------------------------------------------------

export default function RaspberryPiBoard({ variant, pins, selected, busy, onSelect, onHover }: PiBoardProps) {
  const s = SIZES[variant];
  const pcb = variant === "pi400" ? "#27272a" : "url(#rpi-pcb)";
  const headerLeft = s.headerX - 10 * PITCH;
  return (
    <svg viewBox={`-3 -6 ${s.w + 6} ${s.h + 9}`} className="w-full h-auto select-none" role="group" aria-label="Raspberry Pi GPIO header">
      <defs>
        <linearGradient id="rpi-pcb" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14532d" />
          <stop offset="1" stopColor="#166534" />
        </linearGradient>
        <linearGradient id="rpi-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4e4e7" />
          <stop offset="1" stopColor="#a1a1aa" />
        </linearGradient>
        <radialGradient id="rpi-glow">
          <stop offset="0" stopColor="#fde047" stopOpacity="0.95" />
          <stop offset="1" stopColor="#fde047" stopOpacity="0" />
        </radialGradient>
      </defs>

      {variant === "pi400"
        ? <rect x={0} y={0} width={s.w} height={s.h} rx={3} fill="#e11d48" />
        : <rect x={0} y={0} width={s.w} height={s.h} rx={3} fill={pcb} stroke="#052e16" strokeWidth={0.3} />}
      <Decorations variant={variant} />

      {/* Header housing */}
      <rect x={headerLeft} y={s.headerY - PITCH} width={20 * PITCH} height={2 * PITCH} rx={0.3} fill="#09090b" stroke="#3f3f46" strokeWidth={0.15} />
      <Silk x={headerLeft - 0.6} y={s.headerY + 1.9} size={1.3} anchor="end">1</Silk>
      <Silk x={headerLeft + 20 * PITCH + 0.6} y={s.headerY - 0.7} size={1.3}>40</Silk>

      {PI_HEADER.map(pin => {
        const { x, y } = pinPosition(variant, pin.physical);
        const v = pins[pin.physical] ?? {};
        const usable = isUsableGpio(pin);
        const isSel = selected === pin.physical;
        const color = PIN_COLORS[pin.kind];
        const busyBy = busy?.[pin.physical];
        return (
          <g
            key={pin.physical}
            role="button"
            tabIndex={0}
            aria-label={`Pin ${pin.physical} ${pin.label}`}
            aria-pressed={isSel}
            style={{ cursor: "pointer", outline: "none" }}
            onClick={() => onSelect(pin.physical)}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(pin.physical); } }}
            onPointerEnter={e => onHover(pin, e)}
            onPointerMove={e => onHover(pin, e)}
            onPointerLeave={() => onHover(undefined)}
          >
            {v.live && <circle cx={x} cy={y} r={2.2} fill="url(#rpi-glow)" pointerEvents="none" />}
            <rect x={x - PITCH / 2} y={y - PITCH / 2} width={PITCH} height={PITCH} fill="transparent" />
            {pin.physical === 1
              ? <rect x={x - 0.85} y={y - 0.85} width={1.7} height={1.7} fill="#d4af37" stroke={color} strokeWidth={0.45} />
              : <circle cx={x} cy={y} r={0.85} fill="#d4af37" stroke={color} strokeWidth={0.45} />}
            <rect x={x - 0.32} y={y - 0.32} width={0.64} height={0.64} fill={usable ? "#78716c" : "#57534e"} />
            {v.mode && (
              <text x={x} y={y + (pin.physical % 2 === 0 ? -1.55 : 2.35)} fontSize={1.05} textAnchor="middle" fontWeight={700}
                fill={v.problem ? "#f87171" : v.mode === "Input" ? "#67e8f9" : v.mode === "Pwm" ? "#f0abfc" : "#86efac"} pointerEvents="none">
                {v.mode === "Input" ? "IN" : v.mode === "Pwm" ? "PWM" : "OUT"}
              </text>
            )}
            {v.used && <circle cx={x + 0.95} cy={y - 0.95} r={0.38} fill="#38bdf8" stroke="#082f49" strokeWidth={0.1} pointerEvents="none" />}
            {busyBy && <circle cx={x - 0.95} cy={y - 0.95} r={0.38} fill="#a855f7" stroke="#2e1065" strokeWidth={0.1} pointerEvents="none" />}
            {isSel && <circle cx={x} cy={y} r={1.35} fill="none" stroke="#ffffff" strokeWidth={0.3} pointerEvents="none" />}
          </g>
        );
      })}
    </svg>
  );
}
