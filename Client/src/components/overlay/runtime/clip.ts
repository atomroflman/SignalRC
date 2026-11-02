// Clip state machine (Shared/Overlay/runtime/README.md §6). Pure: one call per
// frame with the condition result of that frame.
import type { Clip } from "../document/types";
import type { ValueState } from "../expression";

export type ClipPhase = "idle" | "running" | "finishing" | "ended" | "suspended";

export interface ClipState {
  phase: ClipPhase;
  /** Start of the current run (running/finishing). */
  start: number;
  /** finishing: iteration index at deactivation; the run ends when it is left. */
  iteration: number;
  /** Pulse history: unknown at session start and after a non-valid frame. */
  prev: "unknown" | boolean;
}

export interface ConditionResult {
  state: ValueState;
  value?: unknown;
}

export interface ClipOutput {
  /** "tau": track values at `tau`; "base": base values; "hold": values of the last frame before suspension. */
  output: "tau" | "base" | "hold";
  tau: number;
}

export function initialClipState(): ClipState {
  return { phase: "idle", start: 0, iteration: 0, prev: "unknown" };
}

const repeatCount = (clip: Clip) => (clip.repeat === "infinite" ? Infinity : (clip.repeat ?? 1));

/**
 * Transition of one frame at time `t`. `first` marks the first frame of the
 * session; auto clips start at `sessionStart` (default: that first frame).
 */
export function stepClip(
  state: ClipState, clip: Clip, t: number, first: boolean, cond?: ConditionResult, sessionStart?: number,
): ClipState {
  const trigger = clip.trigger;
  let s = { ...state };
  if (trigger.mode === "auto") {
    if (first) s = { ...s, phase: "running", start: Math.min(sessionStart ?? t, t) };
  } else if (!cond || cond.state !== "valid" || typeof cond.value !== "boolean") {
    // Invalid or unchecked: dependent movement stops (§3).
    if (s.phase === "running" || s.phase === "finishing") s.phase = "suspended";
    s.prev = "unknown";
    return s;
  } else {
    const value = cond.value;
    if (trigger.mode === "whileTrue") {
      switch (s.phase) {
        case "idle":
        case "suspended":
          // After suspension the trigger is evaluated as at session start.
          s = value ? { ...s, phase: "running", start: t } : { ...s, phase: "idle" };
          break;
        case "running":
          if (!value) {
            if ((trigger.onDeactivate ?? "stop") === "stop") s.phase = "ended";
            else s = { ...s, phase: "finishing", iteration: Math.floor((t - s.start) / clip.durationS) };
          }
          break;
        case "finishing":
          if (value) s.phase = "running";
          break;
        case "ended":
          if (!value) s.phase = "idle";
          break;
      }
    } else {
      const edge = s.prev === false && value;
      s.prev = value;
      switch (s.phase) {
        case "suspended":
          s.phase = "idle";
          break;
        case "idle":
        case "ended":
          if (edge) s = { ...s, phase: "running", start: t };
          break;
        case "running":
          if (edge && (trigger.retrigger ?? "restart") === "restart") s.start = t;
          break;
      }
    }
  }
  if (s.phase === "running" || s.phase === "finishing") {
    const e = t - s.start;
    const d = clip.durationS;
    if (!(d > 0) || e >= repeatCount(clip) * d) s.phase = "ended";
    else if (s.phase === "finishing" && Math.floor(e / d) > s.iteration) s.phase = "ended";
  }
  return s;
}

/** What the tracks of a clip show in its current state. */
export function clipOutput(state: ClipState, clip: Clip, t: number): ClipOutput {
  const d = clip.durationS;
  switch (state.phase) {
    case "running":
    case "finishing": {
      const e = t - state.start;
      return { output: "tau", tau: e - d * Math.floor(e / d) };
    }
    case "ended":
      return (clip.endState ?? "base") === "hold" ? { output: "tau", tau: d } : { output: "base", tau: 0 };
    case "suspended":
      return { output: "hold", tau: 0 };
    case "idle":
      return { output: "base", tau: 0 };
  }
}
