import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Controller rütteln": rumble of the controllers matching `device` (part of the name or
// address; empty = all), strengths 0…1. In the vehicle flow the vehicle rumbles its own
// controllers (Onboard/Flow/FlowFunctions.cs); in the browser flow the browser's gamepads
// rumble, where the browser supports it (Gamepad API "dual-rumble", e.g. Chrome and Edge).
// Output: the stronger motor.

type Wanted = { filter: string; strong: number; weak: number };
const wanted = new Map<number, Wanted>();
let timer: ReturnType<typeof setInterval> | undefined;
// The browser flow only evaluates on changes; effects run this long and are renewed in time.
const EFFECT_MS = 1500;
const RENEW_MS = 1000;

function clamp01(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

function gamepads(filter: string): any[] {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return [];
  const f = filter.trim().toLowerCase();
  return Array.from(navigator.getGamepads() ?? []).filter((g): g is Gamepad => !!g && g.connected && (f === "" || g.id.toLowerCase().includes(f)));
}

function play() {
  // Several nodes on one gamepad: the strongest wins per motor.
  const perPad = new Map<any, { strong: number; weak: number }>();
  for (const w of wanted.values())
    for (const pad of gamepads(w.filter)) {
      const p = perPad.get(pad) ?? { strong: 0, weak: 0 };
      perPad.set(pad, { strong: Math.max(p.strong, w.strong), weak: Math.max(p.weak, w.weak) });
    }
  for (const [pad, m] of perPad) {
    const actuator = (pad as any).vibrationActuator;
    if (!actuator?.playEffect) continue;
    actuator.playEffect("dual-rumble", { startDelay: 0, duration: EFFECT_MS, strongMagnitude: m.strong, weakMagnitude: m.weak }).catch(() => undefined);
  }
}

function stopAll(filter: string) {
  for (const pad of gamepads(filter)) (pad as any).vibrationActuator?.reset?.().catch?.(() => undefined);
}

/** Ends the rumble of a browser node (node deleted, flow reloaded). */
export function stopBrowserRumble(nodeId?: number) {
  const ids = nodeId === undefined ? [...wanted.keys()] : [nodeId];
  for (const id of ids) {
    const w = wanted.get(id);
    if (!w) continue;
    wanted.delete(id);
    stopAll(w.filter);
  }
  if (wanted.size === 0 && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
  if (wanted.size > 0) play();
}

export class ControllerRumbleFunction implements FilterFunctionDef<readonly ["strong", "weak"]> {
  name = "ControllerRumble";
  label = "Controller rütteln";
  params: FilterFunctionParam[] = [
    { name: "device", label: "Device (name part or address, empty = all)", type: "string", default: "" },
  ];
  inputLabels = ["strong", "weak"];
  outputLabels = ["value"];

  apply(inputs: InputMap<readonly ["strong", "weak"]>, params: Record<string, any>, nodeId?: number) {
    const strong = clamp01(inputs.strong);
    const weak = clamp01(inputs.weak);
    if (nodeId !== undefined && typeof window !== "undefined") {
      const filter = String(params?.device ?? "");
      if (strong > 0 || weak > 0) {
        wanted.set(nodeId, { filter, strong, weak });
        play();
        timer ??= setInterval(play, RENEW_MS);
      } else if (wanted.has(nodeId)) {
        stopBrowserRumble(nodeId);
      }
    }
    return [Math.max(strong, weak)];
  }
}
