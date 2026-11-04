import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// Dead zone around 0 for axes. Inside ±deadzone the output is 0.
// rescale ≠ 0: the remaining travel is stretched back to the full range,
// so the output starts at 0 on the edge of the dead zone (no jump).
// rescale = 0: outside the dead zone the input passes unchanged.
export class DeadZoneFunction implements FilterFunctionDef<readonly ["input"]> {
  name = "DeadZone";
  label = "Dead Zone";
  params: FilterFunctionParam[] = [
    { name: "deadzone", label: "Dead zone", type: "number", default: 0.05 },
    { name: "rescale", label: "Rescale (1 = on, 0 = off)", type: "number", default: 1 },
  ];
  inputLabels = ["input"];
  outputLabels = ["output"];

  apply(inputs: InputMap<readonly ["input"]>, params: Record<string, any>) {
    const input = Number(inputs.input ?? 0);
    if (!Number.isFinite(input)) return [0];

    const raw = Number(params?.deadzone ?? 0.05);
    const deadzone = Number.isFinite(raw) ? Math.min(Math.max(Math.abs(raw), 0), 0.999) : 0.05;
    const rescale = Number(params?.rescale ?? 1) !== 0;

    const magnitude = Math.abs(input);
    if (magnitude <= deadzone) return [0];
    if (!rescale) return [input];
    return [(Math.sign(input) * (magnitude - deadzone)) / (1 - deadzone)];
  }
}
