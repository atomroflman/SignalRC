import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

/**
 * Current value of every Telemetry node by nodeId, written by the flow
 * telemetry binding (flow-telemetry.ts) from the shared live sources.
 */
export const telemetryInputValues = new Map<number, { value: number; valid: boolean }>();

/** Telemetry text as a flow number: numbers as they are, true/false as 1/0, anything else 0. */
export function telemetryNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const t = String(raw ?? "").trim().toLowerCase();
  if (t === "true") return 1;
  if (t === "false" || t === "") return 0;
  const n = Number(t.replace(/[^0-9eE+.-].*$/, ""));
  return Number.isFinite(n) ? n : 0;
}

// "Telemetrie": outputs a vehicle telemetry channel, e.g. a GPIO input (1/0)
// or a PWM readback. No inputs. "valid" is 0 while the value is stale,
// erroneous or missing; "value" then holds the fallback.
export class TelemetryFunction implements FilterFunctionDef<readonly []> {
  name = "Telemetry";
  label = "Telemetrie";
  params: FilterFunctionParam[] = [
    { name: "channel", label: "channel", type: "string", default: "" },
    { name: "fallback", label: "fallback", type: "number", default: 0 },
  ];
  inputLabels: string[] = [];
  outputLabels = ["value", "valid"];

  apply(_inputs: InputMap<readonly []>, params: Record<string, any>, nodeId?: number) {
    const v = nodeId !== undefined ? telemetryInputValues.get(nodeId) : undefined;
    const fallback = Number(params?.fallback ?? 0);
    if (!v || !v.valid) return [Number.isFinite(fallback) ? fallback : 0, 0];
    return [v.value, 1];
  }
}
