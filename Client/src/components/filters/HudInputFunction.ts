import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

/**
 * Current value of every HudInput node by nodeId. Set by HUD clicks
 * (control-flow-store applyHudInput) and kept in the driver's browser only:
 * a click must not cost a server write, and after a reload every input is 0.
 */
export const hudInputValues = new Map<number, number>();

// "HUD-Eingabe" (D75): outputs the value the clickable HUD elements with the
// same input name write (overlay/integration/hud-input.ts). No inputs.
export class HudInputFunction implements FilterFunctionDef<readonly []> {
  name = "HudInput";
  label = "HUD-Eingabe";
  params: FilterFunctionParam[] = [
    { name: "input", label: "input", type: "string", default: "" },
  ];
  inputLabels: string[] = [];
  outputLabels = ["value"];

  apply(_inputs: InputMap<readonly []>, _params: Record<string, any>, nodeId?: number) {
    return [nodeId !== undefined ? hudInputValues.get(nodeId) ?? 0 : 0];
  }
}
