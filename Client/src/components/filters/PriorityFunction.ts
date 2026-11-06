import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Vorrang" (OnboardFlow-Arbeitspakete.md OF02): a while aActive ≥ 0.5, otherwise b.
export class PriorityFunction implements FilterFunctionDef<readonly ["a", "aActive", "b"]> {
  name = "Priority";
  label = "Vorrang";
  params: FilterFunctionParam[] = [];
  inputLabels = ["a", "aActive", "b"];
  outputLabels = ["output"];

  apply(inputs: InputMap<readonly ["a", "aActive", "b"]>) {
    return [Number(inputs.aActive ?? 0) >= 0.5 ? Number(inputs.a ?? 0) : Number(inputs.b ?? 0)];
  }
}
