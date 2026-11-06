import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Controller Farbe": light bar colour of the vehicle's controllers matching `device`,
// channels 0…1. Vehicle flow only (Server/Services/FlowZoneRules.cs): browsers cannot set
// the light bar. The browser only knows it for the editor and the reference cases.
// Output: the brightest channel.
const clamp01 = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
};

export class ControllerLightFunction implements FilterFunctionDef<readonly ["red", "green", "blue"]> {
  name = "ControllerLight";
  label = "Controller Farbe";
  params: FilterFunctionParam[] = [
    { name: "device", label: "Device (name part or address, empty = all)", type: "string", default: "" },
  ];
  inputLabels = ["red", "green", "blue"];
  outputLabels = ["value"];

  apply(inputs: InputMap<readonly ["red", "green", "blue"]>) {
    return [Math.max(clamp01(inputs.red), clamp01(inputs.green), clamp01(inputs.blue))];
  }
}
