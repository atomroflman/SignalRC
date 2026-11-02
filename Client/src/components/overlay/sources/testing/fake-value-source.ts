// Test double of the value source port (modules/README.md §1): fixed values
// set by the test, no hub and no aging. Not for the live path.
import { decodeLidarGrid } from "../lidar-grid";
import type { LidarGridValue, OverlayValueSource, QualifiedValue } from "../types";

export class FakeValueSource implements OverlayValueSource {
  private readonly values = new Map<string, QualifiedValue>();
  private readonly listeners = new Set<() => void>();
  driver = false;

  set(kind: "tel" | "out" | "sig", name: string, value: QualifiedValue) {
    this.values.set(`${kind}:${name}`, value);
    for (const l of [...this.listeners]) l();
  }

  get(kind: "tel" | "out" | "sig", name: string): QualifiedValue {
    return this.values.get(`${kind}:${name}`) ?? { state: "invalid", reason: "no-data" };
  }

  lidarGrid(name: string): LidarGridValue {
    const v = this.get("tel", name);
    if (v.state === "invalid") return v;
    const grid = decodeLidarGrid(String(v.value));
    return grid ? { ...v, grid } : { state: "invalid", reason: "parse" };
  }

  driverActive() {
    return this.driver;
  }

  driverActiveValue(): QualifiedValue {
    return { state: "valid", value: this.driver };
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
