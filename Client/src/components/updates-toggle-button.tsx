import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";

type Props = {
  updatesEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

// Play triangle with rounded corners, drawn as a race track the car laps
// clockwise: fast on the straights, braking and drifting through the corners.
type Pt = [number, number];
const CORNERS: Array<{ p0: Pt; c: Pt; p2: Pt }> = [
  { p0: [7, 8], c: [7, 5], p2: [9.6, 6.5] },
  { p0: [16.4, 10.5], c: [19, 12], p2: [16.4, 13.5] },
  { p0: [9.6, 17.5], c: [7, 19], p2: [7, 16] },
];
const LAP_S = 2.8;
const CORNER_SLOWDOWN = 2.2; // a corner takes this much longer per unit than a straight
const DRIFT_DEG = 34;
const SKID_OFFSETS = [0.25, 1.05]; // rear tyres, towards the outside of the corner

const quad = (q: { p0: Pt; c: Pt; p2: Pt }, t: number): Pt => {
  const u = 1 - t;
  return [u * u * q.p0[0] + 2 * u * t * q.c[0] + t * t * q.p2[0], u * u * q.p0[1] + 2 * u * t * q.c[1] + t * t * q.p2[1]];
};
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const quadLength = (q: { p0: Pt; c: Pt; p2: Pt }) => {
  let len = 0;
  for (let i = 1; i <= 32; i++) len += dist(quad(q, (i - 1) / 32), quad(q, i / 32));
  return len;
};
const f = (n: number) => n.toFixed(3);

const TRACK = `M${CORNERS[0].p0.join(" ")}` + CORNERS.map((q, i) =>
  `Q${q.c.join(" ")} ${q.p2.join(" ")}L${CORNERS[(i + 1) % CORNERS.length].p0.join(" ")}`).join("") + "Z";

/** Motion timing, drift rotation and skid marks, all derived from the same lap. */
const LAP = (() => {
  // Segments in path order: corner, straight, corner, straight, ...
  const segs = CORNERS.flatMap((q, i) => [
    { corner: true, len: quadLength(q) },
    { corner: false, len: dist(q.p2, CORNERS[(i + 1) % CORNERS.length].p0) },
  ]);
  const totalLen = segs.reduce((a, s) => a + s.len, 0);
  const totalTime = segs.reduce((a, s) => a + s.len * (s.corner ? CORNER_SLOWDOWN : 1), 0);
  const points = [0], times = [0];
  const corners: Array<{ entry: number; exit: number; settle: number }> = [];
  let len = 0, time = 0;
  segs.forEach((s, i) => {
    const start = time;
    len += s.len;
    time += s.len * (s.corner ? CORNER_SLOWDOWN : 1);
    points.push(len / totalLen);
    times.push(time / totalTime);
    if (s.corner) {
      const straight = segs[i + 1];
      corners.push({ entry: start / totalTime, exit: time / totalTime, settle: (time + straight.len * 0.45) / totalTime });
    }
  });

  // Drift: the tail steps out through the corner and catches up on the following straight.
  const rot: Array<[number, number]> = [[0, 0]];
  for (const c of corners) {
    rot.push([c.entry, 0], [c.entry + (c.exit - c.entry) * 0.55, DRIFT_DEG], [c.exit, DRIFT_DEG * 0.6], [c.settle, 0]);
  }
  rot.push([1, 0]);

  // Skid marks: offset curves on the outside of each corner, drawn while the car slides, then fading.
  const skids = CORNERS.map((q, i) => {
    const c = corners[i];
    const paths = SKID_OFFSETS.map(off => {
      const pts: string[] = [];
      for (let k = 0; k <= 16; k++) {
        const t = k / 16;
        const a = quad(q, Math.max(0, t - 0.01)), b = quad(q, Math.min(1, t + 0.01)), p = quad(q, t);
        const d = dist(a, b) || 1;
        // Outside of a clockwise (right) turn is the left of the direction of travel: (dy, -dx).
        pts.push(`${f(p[0] + ((b[1] - a[1]) / d) * off)} ${f(p[1] - ((b[0] - a[0]) / d) * off)}`);
      }
      return "M" + pts.join("L");
    });
    return {
      paths,
      dash: cyclic([[c.entry, 1], [c.exit, 0], [c.exit + 0.5, 0], [c.exit + 0.51, 1]]),
      opacity: cyclic([[c.entry - 0.005, 0], [c.entry, 0.85], [c.exit + 0.3, 0.85], [c.exit + 0.5, 0]]),
    };
  });

  return {
    keyPoints: points.map(f).join(";"),
    keyTimes: times.map(f).join(";"),
    rotValues: rot.map(([, v]) => `${f(v)} 0.8 0`).join(";"),
    rotTimes: rot.map(([t]) => f(t)).join(";"),
    skids,
  };
})();

/** SMIL keyframes (keyTimes 0..1) for a periodic function given by points starting anywhere in the lap. */
function cyclic(pts: Array<[number, number]>): { values: string; keyTimes: string } {
  const t0 = pts[0][0];
  const at = (t: number) => {
    let x = t;
    while (x < t0) x += 1;
    while (x >= t0 + 1) x -= 1;
    const ring = [...pts, [t0 + 1, pts[0][1]] as [number, number]];
    for (let i = 1; i < ring.length; i++) {
      if (x <= ring[i][0]) {
        const [ta, va] = ring[i - 1], [tb, vb] = ring[i];
        return tb === ta ? vb : va + ((vb - va) * (x - ta)) / (tb - ta);
      }
    }
    return pts[0][1];
  };
  const ts = [...new Set([0, 1, ...pts.map(([t]) => ((t % 1) + 1) % 1)])].sort((a, b) => a - b);
  return { values: ts.map(t => f(at(t))).join(";"), keyTimes: ts.map(f).join(";") };
}

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
      {animate && LAP.skids.map((skid, i) => (
        <g key={i} fill="none" stroke="#020617" strokeWidth={0.45} strokeLinecap="round" opacity={0}>
          {skid.paths.map((d, j) => (
            <path key={j} d={d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1}>
              <animate attributeName="stroke-dashoffset" dur={`${LAP_S}s`} repeatCount="indefinite" calcMode="linear" values={skid.dash.values} keyTimes={skid.dash.keyTimes} />
            </path>
          ))}
          <animate attributeName="opacity" dur={`${LAP_S}s`} repeatCount="indefinite" calcMode="linear" values={skid.opacity.values} keyTimes={skid.opacity.keyTimes} />
        </g>
      ))}
      <g transform={animate ? undefined : "translate(13 8.5) rotate(30)"}>
        {/* Inner group: drift angle around the front axle, on top of the heading from the motion path. */}
        <g>
          <rect x={-1.5} y={-0.85} width={3} height={1.7} rx={0.5} fill="#fff" />
          <rect x={0.6} y={-0.6} width={0.7} height={1.2} rx={0.2} fill="#4ade80" />
          {animate && (
            <animateTransform attributeName="transform" type="rotate" dur={`${LAP_S}s`} repeatCount="indefinite" calcMode="linear" values={LAP.rotValues} keyTimes={LAP.rotTimes} />
          )}
        </g>
        {animate && (
          <animateMotion dur={`${LAP_S}s`} repeatCount="indefinite" rotate="auto" path={TRACK} calcMode="linear" keyPoints={LAP.keyPoints} keyTimes={LAP.keyTimes} />
        )}
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
