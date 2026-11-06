import React from "react";

type Props = {
  title: string;
  onStop: () => void;
};

/**
 * Ends the control session: a pit garage with the car in front of it. On hover
 * (or keyboard focus) the car parks inside, the roller door comes down, the
 * ignition key turns off and the ignition lamp goes dark (styles in globals.css).
 */
export default function StopSessionButton({ title, onStop }: Props) {
  return (
    <button
      type="button"
      className="stop-pit flex h-12 w-12 items-center justify-center rounded-md bg-red-600 hover:bg-red-700 text-white"
      title={title}
      aria-label={title}
      onClick={onStop}
    >
      <svg viewBox="0 0 24 24" className="h-10 w-10" aria-hidden="true">
        {/* Ignition lamp, top left. */}
        <circle className="stop-pit__lamp" cx={3.6} cy={3.4} r={1.2} />
        {/* Ignition lock with the key grip, top right: horizontal = on, vertical = off. */}
        <circle cx={20.3} cy={3.6} r={2.5} fill="#7f1d1d" stroke="#fff" strokeWidth={0.7} />
        <g className="stop-pit__key">
          <rect x={19.65} y={1.6} width={1.3} height={4} rx={0.55} fill="#fde68a" />
          <circle cx={20.3} cy={3.6} r={0.45} fill="#7f1d1d" />
        </g>

        {/* Garage: dark opening, the car, then the roller door on top of it. */}
        <rect x={5.8} y={9.8} width={12.4} height={10.2} fill="#450a0a" />
        <g className="stop-pit__car">
          <path d="M9.6 11.4H14.4L15.6 13.6H8.4Z" fill="#fff" />
          <path d="M10.2 12H13.8L14.6 13.4H9.4Z" fill="#1e293b" />
          <rect x={7.6} y={13.4} width={8.8} height={4.4} rx={1.1} fill="#fff" />
          <rect x={8.3} y={14.6} width={1.7} height={0.9} rx={0.3} className="stop-pit__taillight" />
          <rect x={14} y={14.6} width={1.7} height={0.9} rx={0.3} className="stop-pit__taillight" />
          <rect x={10.6} y={16} width={2.8} height={0.8} rx={0.2} fill="#cbd5e1" />
          <rect x={8} y={17.6} width={1.8} height={1.5} rx={0.4} fill="#0f172a" />
          <rect x={14.2} y={17.6} width={1.8} height={1.5} rx={0.4} fill="#0f172a" />
        </g>
        <g className="stop-pit__door">
          <rect x={5.8} y={9.8} width={12.4} height={10.2} fill="#e5e7eb" />
          <path d="M5.8 12.4H18.2M5.8 15H18.2M5.8 17.6H18.2" stroke="#9ca3af" strokeWidth={0.5} />
        </g>

        {/* Pit building with the P in the gable. */}
        <path d="M3 9.4 12 3.6 21 9.4M5 9.2V20.2M19 9.2V20.2" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        <text x={12} y={8.5} textAnchor="middle" fontSize={4.4} fontWeight={800} fontFamily="system-ui, sans-serif" fill="#fff">P</text>
        <path d="M2.4 20.9H21.6" stroke="#fff" strokeWidth={1} strokeLinecap="round" opacity={0.7} />
      </svg>
    </button>
  );
}
