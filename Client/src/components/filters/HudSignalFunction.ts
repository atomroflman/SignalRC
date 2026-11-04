import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "HUD-Signal" (D37): maps its input to a named HUD signal of the vehicle's
// overlay (sig("name")). Display only: it has no output and never produces a
// vehicle command; the control display reads its value (overlay/integration).
export class HudSignalFunction implements FilterFunctionDef<readonly ["value"]> {
  name = "HudSignal";
  label = "HUD-Signal";
  params: FilterFunctionParam[] = [
    { name: "signal", label: "signal", type: "string", default: "" },
  ];
  inputLabels = ["value"];
  outputLabels: string[] = [];

  apply(inputs: InputMap<readonly ["value"]>) {
    const value = Number(inputs.value ?? 0);
    return [Number.isFinite(value) ? value : 0];
  }
}
