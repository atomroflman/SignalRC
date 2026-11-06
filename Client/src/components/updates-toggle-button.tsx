import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";

type Props = {
  updatesEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

// Play triangle with rounded corners, drawn as a race track the car laps.
const TRACK = "M7 8Q7 5 9.6 6.5L16.4 10.5Q19 12 16.4 13.5L9.6 17.5Q7 19 7 16Z";

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Paused: pulsing race track play button with a lapping car. Sending: a rumbling steering wheel (click pauses). */
function RaceTrackIcon({ animate }: { animate: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      {/* Two kerb lines: a wide white stroke with the asphalt drawn on top of it. */}
      <path d={TRACK} fill="none" stroke="#fff" strokeWidth={5.4} strokeLinejoin="round" />
      <path d={TRACK} fill="none" stroke="#14532d" strokeWidth={3.6} strokeLinejoin="round" />
      <path d={TRACK} fill="none" stroke="#86efac" strokeWidth={0.5} strokeDasharray="1 1.2" opacity={0.7} />
      <g transform={animate ? undefined : "translate(13 8.5) rotate(30)"}>
        <rect x={-1.5} y={-0.85} width={3} height={1.7} rx={0.5} fill="#fff" />
        <rect x={0.6} y={-0.6} width={0.7} height={1.2} rx={0.2} fill="#4ade80" />
        {animate && <animateMotion dur="2.4s" repeatCount="indefinite" rotate="auto" path={TRACK} />}
      </g>
    </svg>
  );
}

function SteeringWheelIcon() {
  return (
    <svg viewBox="0 0 24 24" className="updates-wheel h-5 w-5" aria-hidden="true">
      <g className="updates-wheel__rumble">
        <g className="updates-wheel__steer" fill="none" stroke="currentColor" strokeLinecap="round">
          <circle cx={12} cy={12} r={8.5} strokeWidth={2.4} />
          <circle cx={12} cy={12} r={2.2} strokeWidth={1.8} />
          <path d="M3.8 11.2 9.8 11.6M14.2 11.6 20.2 11.2M12 14.2 12 20.3" strokeWidth={2} />
          {/* Top marker, so the wild steering is readable. */}
          <path d="M12 3.4V5.6" stroke="#fde68a" strokeWidth={2.4} />
        </g>
      </g>
    </svg>
  );
}

export default function UpdatesToggleButton({ updatesEnabled, onToggle, disabled }: Props) {
  const { messages } = useI18n();
  const reducedMotion = usePrefersReducedMotion();
  const label = updatesEnabled ? messages.carControl.pauseUpdates : messages.carControl.resumeUpdates;

  return (
    <button
      type="button"
      className={updatesEnabled
        ? "p-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
        : "updates-resume p-0.5 rounded text-white disabled:opacity-40"}
      title={label}
      aria-label={label}
      aria-pressed={!updatesEnabled}
      disabled={disabled}
      onClick={onToggle}
    >
      {updatesEnabled ? <SteeringWheelIcon /> : <RaceTrackIcon animate={!reducedMotion && !disabled} />}
    </button>
  );
}
