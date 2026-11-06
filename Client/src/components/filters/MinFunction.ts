import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

export class MinFunction implements FilterFunctionDef<readonly ["a", "b"]> {
  name = 'Min';
  label = 'Min (kleinerer Wert)';
  params: FilterFunctionParam[] = [];
  inputLabels = ["a", "b"];
  outputLabels = ['min'];
  apply(inputs: InputMap<readonly ["a", "b"]>) {
    return [Math.min(inputs.a ?? 0, inputs.b ?? 0)];
  }
}
