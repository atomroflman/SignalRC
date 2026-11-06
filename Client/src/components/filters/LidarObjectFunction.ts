import { FilterFunctionDef, FilterFunctionParam, InputMap } from "./filter-function-registry";

// "Lidar Objekt": distance to the nearest object in an angle range of the vehicle's lidar.
// Vehicle flow only (Server/Services/FlowZoneRules.cs); the vehicle computes it
// (Onboard/Flow/FlowFunctions.cs LidarObjectFn) from every revolution at full resolution.
// The browser only knows it for the editor and the reference cases: no lidar, nothing found.
export class LidarObjectFunction implements FilterFunctionDef<readonly []> {
  name = "LidarObject";
  label = "Lidar Objekt";
  params: FilterFunctionParam[] = [
    { name: "from", label: "from (°, 0 = straight ahead)", type: "number", default: -15 },
    { name: "to", label: "to (°)", type: "number", default: 15 },
    { name: "points", label: "points (min. per object)", type: "number", default: 3 },
    { name: "maxJump", label: "maxJump (cm between neighbours)", type: "number", default: 10 },
    { name: "none", label: "none (cm when nothing is found)", type: "number", default: 9999 },
    { name: "lidar", label: "lidar (pin manager)", type: "string", default: "lidar" },
  ];
  inputLabels = [];
  outputLabels = ["distance", "angle", "found", "ok"];

  apply(_inputs: InputMap<readonly []>, params: Record<string, any>) {
    const none = Number(params?.none ?? 9999);
    return [Number.isFinite(none) ? none : 9999, 0, 0, 0];
  }
}
