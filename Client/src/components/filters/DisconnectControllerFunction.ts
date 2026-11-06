import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

const last = new Map<number, boolean>();

// "Controller trennen": vehicle flow only (Server/Services/FlowZoneRules.cs). On a rising
// edge of trigger the vehicle disconnects its Bluetooth controllers matching `device`
// (part of the name or the address; empty: all). The browser only knows it for the editor
// and the reference cases; output 1 in the evaluation that triggered.
export class DisconnectControllerFunction implements FilterFunctionDef<readonly ["trigger"]> {
  name = "DisconnectController";
  label = "Controller trennen";
  params: FilterFunctionParam[] = [
    { name: "device", label: "Device (name part or address, empty = all)", type: "string", default: "" },
  ];
  inputLabels = ["trigger"];
  outputLabels = ["triggered"];

  apply(inputs: InputMap<readonly ["trigger"]>, _params: Record<string, any>, nodeId?: number) {
    const key = nodeId ?? -1;
    const on = Number(inputs.trigger ?? 0) >= 0.5;
    const rising = on && !last.get(key);
    last.set(key, on);
    return [rising ? 1 : 0];
  }
}
