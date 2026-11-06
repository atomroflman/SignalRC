import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

export class IifFunction implements FilterFunctionDef<readonly ["a", "b", "ifTrue", "ifFalse"]> {
  name = 'Iif';
  label = 'IIF (If-Then-Else)';
  params: FilterFunctionParam[] = [
    { name: 'operator', label: 'Operator', type: 'string', default: '>' },
    // Switches: that branch outputs 1 instead of its input (unconnected inputs count as 0).
    { name: 'trueIs1', label: 'true → 1', type: 'boolean', default: false },
    { name: 'falseIs1', label: 'false → 1', type: 'boolean', default: false },
  ];
  inputLabels = ["a", "b", "ifTrue", "ifFalse"];
  outputLabels = ['result'];
  apply(inputs: InputMap<readonly ["a", "b", "ifTrue", "ifFalse"]>, params: Record<string, any>) {
    const a = inputs.a ?? 0;
    const b = inputs.b ?? 0;
    // Parameters arrive as text from the server; same parsing as the onboard engine.
    const flag = (v: unknown) => v === true || String(v ?? "").trim().toLowerCase() === "true";
    const trueValue = flag(params?.trueIs1) ? 1 : inputs.ifTrue ?? 0;
    const falseValue = flag(params?.falseIs1) ? 1 : inputs.ifFalse ?? 0;
    const operator = params?.operator || '>';
    
    let condition = false;
    
    switch (operator) {
      case '>':
        condition = a > b;
        break;
      case '<':
        condition = a < b;
        break;
      case '=':
      case '==':
        condition = Math.abs(a - b) < 0.00001; // Float comparison with tolerance
        break;
      case '>=':
        condition = a >= b;
        break;
      case '<=':
        condition = a <= b;
        break;
      case '!=':
      case '<>':
        condition = Math.abs(a - b) >= 0.00001; // Float comparison with tolerance
        break;
      default:
        condition = a > b; // Default to greater than
        break;
    }
    
    return [condition ? trueValue : falseValue];
  }
}
