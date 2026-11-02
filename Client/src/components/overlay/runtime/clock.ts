// Production clock: performance.now() in seconds, frames from one shared
// requestAnimationFrame loop that only runs while someone listens (runtime §1).
import type { Clock } from "./types";

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

export function createAnimationFrameClock(): Clock {
  const listeners = new Set<(t: number) => void>();
  let handle: unknown;
  const hasRaf = typeof requestAnimationFrame === "function";
  const schedule = () => {
    handle = hasRaf ? requestAnimationFrame(tick) : setTimeout(() => tick(), 33);
  };
  const tick = () => {
    handle = undefined;
    if (listeners.size === 0) return;
    const t = now();
    for (const l of [...listeners]) l(t);
    if (listeners.size > 0 && handle === undefined) schedule();
  };
  return {
    now,
    onFrame(cb) {
      listeners.add(cb);
      if (handle === undefined) schedule();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && handle !== undefined) {
          if (hasRaf) cancelAnimationFrame(handle as number);
          else clearTimeout(handle as ReturnType<typeof setTimeout>);
          handle = undefined;
        }
      };
    },
  };
}

let shared: Clock | undefined;

/** The shared production clock. */
export function animationFrameClock(): Clock {
  return (shared ??= createAnimationFrameClock());
}
