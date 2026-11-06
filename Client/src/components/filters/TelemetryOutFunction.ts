import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Telemetrie senden": vehicle flow only (Server/Services/FlowZoneRules.cs). The vehicle
// publishes the input under `key`; a telemetry channel of type FlowValueReader with the
// same key sends it like any telemetry value. The browser knows it for the editor and the
// reference cases; it passes the value on.
export class TelemetryOutFunction implements FilterFunctionDef<readonly ["value"]> {
  name = "TelemetryOut";
  label = "Telemetrie senden";
  params: FilterFunctionParam[] = [
    { name: "key", label: "key (= Key of the FlowValueReader channel)", type: "string", default: "" },
  ];
  inputLabels = ["value"];
  outputLabels = ["value"];

  apply(inputs: InputMap<readonly ["value"]>) {
    const value = Number(inputs.value ?? 0);
    return [Number.isFinite(value) ? value : 0];
  }
}
