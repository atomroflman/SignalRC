import React, { useEffect, useState } from "react";
import { useI18n } from "@/i18n/provider";

type Props = {
  updatesEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

// Play triangle with rounded corners, drawn as a race track the car laps
// clockwise: fast on the straights, braking and drifting through the corners.
// Every corner of every lap gets its own random speed, drift and skid marks.
type Pt = [number, number];
type Quad = { p0: Pt; c: Pt; p2: Pt };
const CORNERS: Quad[] = [
  { p0: [7, 8], c: [7, 5], p2: [9.6, 6.5] },
  { p0: [16.4, 10.5], c: [19, 12], p2: [16.4, 13.5] },
  { p0: [9.6, 17.5], c: [7, 19], p2: [7, 16] },
];
/** Laps per generated run; after a run the icon remounts with fresh random laps. */
const LAPS_PER_RUN = 5;
/** Seconds per unit of track on a straight at normal pace. */
const STRAIGHT_S_PER_UNIT = 0.055;
const SKID_OFFSETS = [0.25, 1.05]; // rear tyres, towards the outside of the corner
const SKID_HOLD_S = 0.7;
const SKID_FADE_S = 0.6;

const quad = (q: Quad, t: number): Pt => {
  const u = 1 - t;
  return [u * u * q.p0[0] + 2 * u * t * q.c[0] + t * t * q.p2[0], u * u * q.p0[1] + 2 * u * t * q.c[1] + t * t * q.p2[1]];
};
const dist = (a: Pt, b: Pt) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const quadLength = (q: Quad) => {
  let len = 0;
  for (let i = 1; i <= 32; i++) len += dist(quad(q, (i - 1) / 32), quad(q, i / 32));
  return len;
};
const f = (n: number) => n.toFixed(4);

const lapSegments = CORNERS.map((q, i) => `Q${q.c.join(" ")} ${q.p2.join(" ")}L${CORNERS[(i + 1) % CORNERS.length].p0.join(" ")}`).join("");
const TRACK = `M${CORNERS[0].p0.join(" ")}${lapSegments}Z`;
/** The motion path runs all laps of a run, so keyPoints stay within 0..1. */
const RUN_PATH = `M${CORNERS[0].p0.join(" ")}${lapSegments.repeat(LAPS_PER_RUN)}`;

// Segments in path order: corner, straight, corner, straight, ...
const SEGMENTS = CORNERS.flatMap((q, i) => [
  { corner: i, len: quadLength(q) },
  { corner: -1, len: dist(q.p2, CORNERS[(i + 1) % CORNERS.length].p0) },
]);
const LAP_LEN = SEGMENTS.reduce((a, s) => a + s.len, 0);

/** Skid mark curves: offsets of each corner curve to its outside. */
const SKID_PATHS = CORNERS.map(q => SKID_OFFSETS.map(off => {
  const pts: string[] = [];
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const a = quad(q, Math.max(0, t - 0.01)), b = quad(q, Math.min(1, t + 0.01)), p = quad(q, t);
    const d = dist(a, b) || 1;
    // Outside of a clockwise (right) turn is the left of the direction of travel: (dy, -dx).
    pts.push(`${f(p[0] + ((b[1] - a[1]) / d) * off)} ${f(p[1] - ((b[0] - a[0]) / d) * off)}`);
  }
  return "M" + pts.join("L");
}));

type Keyframes = { values: string; keyTimes: string };
type Run = {
  dur: number;
  keyPoints: string;
  keyTimes: string;
  rot: Keyframes;
  skids: Array<{ dash: Keyframes; opacity: Keyframes }>;
};

/** SMIL keyframes (keyTimes 0..1) for a periodic function; points are in order and span less than one period. */
function cyclic(pts: Array<[number, number]>, rest = 0): Keyframes {
  if (pts.length === 0) return { values: `${rest};${rest}`, keyTimes: "0;1" };
  const t0 = pts[0][0];
  const ring: Array<[number, number]> = [...pts, [t0 + 1, pts[0][1]]];
  const at = (t: number) => {
    let x = t;
    while (x < t0) x += 1;
    while (x >= t0 + 1) x -= 1;
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

const between = (min: number, max: number) => min + Math.random() * (max - min);

/** Random laps: per corner braking, drift angle (sometimes grip, sometimes a fishtail) and skid intensity. */
function generateRun(): Run {
  type Corner = { corner: number; entry: number; exit: number; peakAt: number; drift: number; fishtail: number; skid: number; settle: number };
  const points = [0], times = [0];
  const corners: Corner[] = [];
  let len = 0, time = 0;
  for (let lap = 0; lap < LAPS_PER_RUN; lap++) {
    const pace = between(0.85, 1.2); // driver mood per lap
    SEGMENTS.forEach((s, i) => {
      const start = time;
      len += s.len;
      if (s.corner >= 0) {
        const grip = Math.random() < 0.2;
        const slowdown = grip ? between(1.3, 1.7) : between(1.7, 3);
        time += s.len * STRAIGHT_S_PER_UNIT * slowdown / pace;
        const straight = SEGMENTS[i + 1];
        const straightTime = straight.len * STRAIGHT_S_PER_UNIT / pace;
        corners.push({
          corner: s.corner, entry: start, exit: time,
          peakAt: between(0.35, 0.75),
          drift: grip ? between(0, 8) : between(22, 50),
          fishtail: !grip && Math.random() < 0.35 ? between(0.25, 0.6) : 0,
          skid: grip ? 0 : between(0.45, 0.95),
          settle: time + straightTime * between(0.35, 0.65),
        });
      } else {
        time += s.len * STRAIGHT_S_PER_UNIT / pace;
      }
      points.push(len / (LAP_LEN * LAPS_PER_RUN));
      times.push(time);
    });
  }
  const dur = time;
  const n = (t: number) => t / dur;

  // Drift around the front axle: the tail steps out, optionally swings back over (fishtail) and catches up.
  const rot: Array<[number, number]> = [[0, 0]];
  for (const c of corners) {
    rot.push([n(c.entry), 0], [n(c.entry + (c.exit - c.entry) * c.peakAt), c.drift], [n(c.exit), c.drift * 0.6]);
    if (c.fishtail) rot.push([n(c.exit + (c.settle - c.exit) * 0.5), -c.drift * c.fishtail]);
    rot.push([n(c.settle), 0]);
  }
  rot.push([1, 0]);

  const skids = CORNERS.map((_, i) => {
    const dash: Array<[number, number]> = [], opacity: Array<[number, number]> = [];
    for (const c of corners.filter(c => c.corner === i && c.skid > 0)) {
      const hold = c.exit + SKID_HOLD_S, gone = hold + SKID_FADE_S;
      dash.push([n(c.entry), 1], [n(c.exit), 0], [n(gone), 0], [n(gone + 0.02), 1]);
      opacity.push([n(c.entry - 0.01), 0], [n(c.entry), c.skid], [n(hold), c.skid], [n(gone), 0]);
    }
    return { dash: cyclic(dash, 1), opacity: cyclic(opacity, 0) };
  });

  return {
    dur,
    keyPoints: points.map(f).join(";"),
    keyTimes: times.map(t => f(n(t))).join(";"),
    rot: { values: rot.map(([, v]) => `${f(v)} 0.8 0`).join(";"), keyTimes: rot.map(([t]) => f(t)).join(";") },
    skids,
  };
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

/** A fresh random run after each one; generated on the client only, so server and client markup match. */
function useRandomRun(active: boolean): { run: Run | null; id: number } {
  const [state, setState] = useState<{ run: Run | null; id: number }>({ run: null, id: 0 });
  useEffect(() => {
    if (!active) { setState(s => ({ run: null, id: s.id })); return; }
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      const run = generateRun();
      setState(s => ({ run, id: s.id + 1 }));
      timer = setTimeout(next, run.dur * 1000);
    };
    next();
    return () => clearTimeout(timer);
  }, [active]);
  return state;
}

/** Paused: pulsing race track play button with a car drifting around it. */
function RaceTrackIcon({ animate }: { animate: boolean }) {
  const { run, id } = useRandomRun(animate);
  const dur = run ? `${f(run.dur)}s` : undefined;

  return (
    // Remounted per run, so all SMIL animations restart together at time 0.
    <svg key={id} viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      {/* Two kerb lines: a wide white stroke with the asphalt drawn on top of it. */}
      <path d={TRACK} fill="none" stroke="#fff" strokeWidth={5.4} strokeLinejoin="round" />
      <path d={TRACK} fill="none" stroke="#14532d" strokeWidth={3.6} strokeLinejoin="round" />
      <path d={TRACK} fill="none" stroke="#86efac" strokeWidth={0.5} strokeDasharray="1 1.2" opacity={0.7} />
      {run && run.skids.map((skid, i) => (
        <g key={i} fill="none" stroke="#020617" strokeWidth={0.45} strokeLinecap="round" opacity={0}>
          {SKID_PATHS[i].map((d, j) => (
            <path key={j} d={d} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1}>
              <animate attributeName="stroke-dashoffset" dur={dur} repeatCount="indefinite" calcMode="linear" values={skid.dash.values} keyTimes={skid.dash.keyTimes} />
            </path>
          ))}
          <animate attributeName="opacity" dur={dur} repeatCount="indefinite" calcMode="linear" values={skid.opacity.values} keyTimes={skid.opacity.keyTimes} />
        </g>
      ))}
      <g transform={run ? undefined : "translate(13 8.5) rotate(30)"}>
        {/* Inner group: drift angle around the front axle, on top of the heading from the motion path. */}
        <g>
          <rect x={-1.5} y={-0.85} width={3} height={1.7} rx={0.5} fill="#fff" />
          <rect x={0.6} y={-0.6} width={0.7} height={1.2} rx={0.2} fill="#4ade80" />
          {run && (
            <animateTransform attributeName="transform" type="rotate" dur={dur} repeatCount="indefinite" calcMode="linear" values={run.rot.values} keyTimes={run.rot.keyTimes} />
          )}
        </g>
        {run && (
          <animateMotion dur={dur} repeatCount="indefinite" rotate="auto" path={RUN_PATH} calcMode="linear" keyPoints={run.keyPoints} keyTimes={run.keyTimes} />
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
