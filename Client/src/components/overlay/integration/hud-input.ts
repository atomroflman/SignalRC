// D75 – clickable HUD elements. An element or SVG part with an `interaction`
// writes to a named HUD input; the flow node "HUD-Eingabe" (HudInput) of that
// name outputs the value. Unlike the control display (control-display-binding.ts),
// this deliberately feeds the flow: a click recalculates the HudInput node and
// everything downstream, and vehicle outputs are sent as for any other input
// (still gated by updatesEnabled / config mode / onboard update).
//
// Only the driver's browser runs the flow and holds the state (e.g. whether a
// toggle is on). A viewer's click on a public interaction goes to the server,
// which checks it against the published document and forwards the action to
// the driver's connection.
import { SIGNAL_NAME } from "../document/schema";
import type { Interaction } from "../document/types";
import type { FlowNodeLike } from "./control-display-binding";

/** Function name of the flow node "HUD-Eingabe". */
export const HUD_INPUT_FUNCTION = "HudInput";

/** press/release: button; toggle: switch between 0 and value; set: value or slider. */
export type HudInputAction = "press" | "release" | "toggle" | "set";

const isHudInputNode = (node: FlowNodeLike) => node.nodeTypeName === "UserSetupFunctionNode" && node.metadata?.functionName === HUD_INPUT_FUNCTION;

function enteredInputName(node: FlowNodeLike): string | undefined {
  if (!isHudInputNode(node)) return undefined;
  const name = node.params?.input;
  return typeof name === "string" && name.trim() !== "" ? name.trim() : undefined;
}

/** The input name a HudInput node listens to, or undefined; same name rule as the document (SIGNAL_NAME). */
export function hudInputName(node: FlowNodeLike): string | undefined {
  const name = enteredInputName(node);
  return name !== undefined && SIGNAL_NAME.test(name) ? name : undefined;
}

/** Why a HudInput node receives nothing, or undefined; undefined for other nodes. Several nodes may share a name. */
export function hudInputProblem(node: FlowNodeLike): "missing" | "invalid" | undefined {
  if (!isHudInputNode(node)) return undefined;
  const entered = enteredInputName(node);
  if (entered === undefined) return "missing";
  return SIGNAL_NAME.test(entered) ? undefined : "invalid";
}

/** New value of a HUD input after an action. */
export function nextHudInputValue(current: number, action: HudInputAction, value: number): number {
  if (action === "release") return 0;
  if (action === "toggle") return current !== 0 ? 0 : value;
  return value;
}

/** Value written by button, toggle and fixed value (default 1). */
export const interactionValue = (i: Interaction) => (Number.isFinite(i.value) ? i.value! : 1);

/** Slider range; undefined when min ≥ max (the slider then does nothing). */
export function sliderRange(i: Interaction): { min: number; max: number } | undefined {
  const min = i.min ?? 0;
  const max = i.max ?? 1;
  return min < max ? { min, max } : undefined;
}

/** Slider value at a position 0 … 1 along the element, snapped to step. */
export function sliderValue(i: Interaction, fraction: number): number | undefined {
  const range = sliderRange(i);
  if (!range) return undefined;
  const f = Math.min(1, Math.max(0, fraction));
  let v = range.min + f * (range.max - range.min);
  if (i.step && i.step > 0) v = range.min + Math.round((v - range.min) / i.step) * i.step;
  // Rounding to 6 significant digits keeps 0.1 steps from turning into 0.30000000000000004.
  return Number(Math.min(range.max, Math.max(range.min, v)).toPrecision(6));
}
