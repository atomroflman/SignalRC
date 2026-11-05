import React, { useEffect, useState } from "react";
import { useControlFlowStore } from "@/components/control-flow-store";
import { sendState } from "@/components/overlay/integration/editor-control";

// The Signal-RC logo (logo-mono-white.svg), split so the draw-in can trace the
// C and the R with its arrow one after the other. The letters are holes in the
// bar of the R (even-odd), so both are always filled as one path.
const VIEW_BOX = "0 35.5 109.5 115";
const R_ARROW = "M5.81 37.5H70A28.5 28.5 0 0 1 75.9 93.88L100.19 118.17L107.26 111.1L106.55 148.57L49.99 92.01L54 77.5H70A11.5 11.5 0 0 0 70 54.5H2.19Z";
const LETTERS = "M16.7 42.06 15.21 43.47Q14.35 42.65 13.21 42.65Q12.62 42.65 12.26 42.88Q11.91 43.1 11.82 43.5Q11.76 43.79 11.88 43.98Q11.99 44.17 12.33 44.34Q12.67 44.51 13.42 44.77Q14.86 45.26 15.41 46Q15.96 46.74 15.69 48.05Q15.48 49 14.84 49.73Q14.2 50.45 13.18 50.86Q12.17 51.26 10.92 51.26Q8.53 51.26 7.33 49.81L8.95 48.35Q9.93 49.33 11.23 49.33Q11.9 49.33 12.34 49.04Q12.78 48.74 12.88 48.25Q12.95 47.91 12.86 47.68Q12.76 47.46 12.43 47.28Q12.1 47.1 11.44 46.88Q9.86 46.35 9.33 45.6Q8.8 44.86 9.04 43.72Q9.23 42.83 9.86 42.15Q10.48 41.47 11.42 41.11Q12.35 40.74 13.41 40.74Q14.55 40.74 15.35 41.07Q16.15 41.4 16.7 42.06ZM19.78 51H17.12L19.25 41H21.91ZM32.21 42.01 30.61 43.37Q30.15 42.99 29.74 42.81Q29.34 42.63 28.78 42.63Q27.7 42.63 26.91 43.46Q26.13 44.29 25.76 46.01Q25.49 47.26 25.54 47.99Q25.59 48.71 25.93 49.03Q26.27 49.35 26.92 49.35Q27.57 49.35 28.16 49.07L28.6 47.01H27.46L27.59 45.19H31.56L30.5 50.17Q29.61 50.68 28.57 50.97Q27.53 51.26 26.59 51.26Q21.89 51.26 23.02 45.99Q23.37 44.35 24.26 43.17Q25.15 41.98 26.39 41.36Q27.63 40.74 29.04 40.74Q31.04 40.74 32.21 42.01ZM40.58 51H37.22L36.29 43.47L36.27 43.78Q36.2 44.77 36.1 45.64Q35.99 46.51 35.76 47.62L35.04 51H32.68L34.81 41H38.09L39.1 48.55Q39.15 47.47 39.24 46.61Q39.33 45.75 39.57 44.63L40.35 41H42.7ZM48.37 48.96H45.72L44.84 51H42.08L47.17 41H50.37L51.2 51H48.38ZM48.36 47.06 48.34 42.9 46.54 47.06ZM55.81 48.93H59.65L58.92 51H52.71L54.83 41H57.5Z";
const R_WITH_LETTERS = `${R_ARROW} ${LETTERS}`;
const C_SHAPE = "M46.74 77.5H37.5A35.5 35.5 0 0 0 37.5 148.5H96.58L79.58 131.5H37.5A19.74 19.74 0 0 1 37.5 92.01H42.73Z";

export type BrandStatus = "idle" | "connected" | "live";

const GLOW: Record<BrandStatus, string> = {
  idle: "#94a3b8",      // slate-400
  connected: "#38bdf8", // sky-400
  live: "#4ade80",      // green-400
};

/** idle: no vehicle; connected: the vehicle is selected; live: control commands are sent. */
export function useBrandStatus(carId?: number): BrandStatus {
  return useControlFlowStore(s => {
    const id = carId ?? s.carId;
    if (id === undefined) return "idle";
    if (sendState(s, id) === "live") return "live";
    return s.carId === id ? "connected" : "idle";
  });
}

// One draw-in per page load and per vehicle; logos mounted together (or by a
// client side page switch) right after share it instead of drawing again.
const SHARE_MS = 400;
let lastDraw: { key: string; at: number } | null = null;
function claimDraw(key: string): boolean {
  const now = Date.now();
  if (lastDraw && lastDraw.key === key) return now - lastDraw.at < SHARE_MS;
  lastDraw = { key, at: now };
  return true;
}

type Props = {
  /** Vehicle of the page; the selected vehicle of the control store otherwise. */
  carId?: number;
  className?: string;
  title?: string;
  /** Large placement (empty video area): wider halo and light streak. */
  large?: boolean;
};

export default function BrandLogo({ carId, className = "h-12 w-auto", title = "Signal-RC", large = false }: Props) {
  const status = useBrandStatus(carId);
  const storeCarId = useControlFlowStore(s => s.carId);
  const drawKey = String(carId ?? storeCarId ?? "none");
  // "pending" renders nothing until the client decided, so a static page never flashes the logo first.
  const [mode, setMode] = useState<{ phase: "pending" | "draw" | "static"; run: number }>({ phase: "pending", run: 0 });
  useEffect(() => {
    const draw = claimDraw(drawKey);
    setMode(m => ({ phase: draw ? "draw" : m.phase === "pending" ? "static" : m.phase, run: draw ? m.run + 1 : m.run }));
  }, [drawKey]);

  return (
    <svg
      viewBox={VIEW_BOX}
      className={`brand-logo brand-logo--${mode.phase} brand-logo--${status}${large ? " brand-logo--large" : ""} ${className}`.trim()}
      role="img"
      aria-label={title}
      style={{ ["--brand-glow" as string]: GLOW[status] }}
    >
      <title>{title}</title>
      {/* The halo is a CSS drop-shadow on the whole svg (in px, so it stays visible when small). */}
      <g key={mode.run}>
        <g className="brand-logo__fill" fill="#fff">
          <path d={C_SHAPE} fillRule="evenodd" />
          <path d={R_WITH_LETTERS} fillRule="evenodd" />
        </g>
        <g className="brand-logo__trace" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke">
          <path d={C_SHAPE} pathLength={1} className="brand-logo__trace-c" vectorEffect="non-scaling-stroke" />
          <path d={R_ARROW} pathLength={1} className="brand-logo__trace-r" vectorEffect="non-scaling-stroke" />
        </g>
        {/* Light streak in the status colour running along the C and the R into the arrow tip. */}
        <g className="brand-logo__comet" fill="none" strokeLinecap="round">
          <path d={C_SHAPE} pathLength={1} vectorEffect="non-scaling-stroke" />
          <path d={R_ARROW} pathLength={1} className="brand-logo__comet-r" vectorEffect="non-scaling-stroke" />
        </g>
      </g>
    </svg>
  );
}
