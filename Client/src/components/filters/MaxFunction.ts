import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

export class MaxFunction implements FilterFunctionDef<readonly ["a", "b"]> {
  name = 'Max';
  label = 'Max (größerer Wert)';
  params: FilterFunctionParam[] = [];
  inputLabels = ["a", "b"];
  outputLabels = ['max'];
  apply(inputs: InputMap<readonly ["a", "b"]>) {
    return [Math.max(inputs.a ?? 0, inputs.b ?? 0)];
  }
}
