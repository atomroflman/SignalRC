import { useEffect, useMemo, useState } from "react";
import { sharedSourceHub, type QualifiedValue } from "@/components/overlay/sources";

/**
 * Live values of some telemetry channels through the shared sources, for the
 * pin editors: a pin lights up while its reader reports 1. Asks only for the
 * named channels and releases them on unmount.
 */
export function useLiveTelemetry(carId: number | undefined, names: string[]): Record<string, QualifiedValue> {
  const key = useMemo(() => [...new Set(names)].sort().join("\n"), [names]);
  const [values, setValues] = useState<Record<string, QualifiedValue>>({});

  useEffect(() => {
    const list = key ? key.split("\n") : [];
    if (!carId || list.length === 0 || typeof window === "undefined") {
      setValues({});
      return;
    }
    const car = sharedSourceHub().acquire(carId);
    const requirement = car.provider.require("pin-board-editor", list.map(name => ({ kind: "tel" as const, name })));
    const read = () => {
      const next: Record<string, QualifiedValue> = {};
      for (const name of list) next[name] = requirement.source.get("tel", name) as QualifiedValue;
      setValues(prev => (list.every(n => prev[n]?.state === next[n].state && prev[n]?.value === next[n].value) ? prev : next));
    };
    const unsubscribe = car.provider.subscribe(read);
    read();
    return () => {
      unsubscribe();
      requirement.release();
      car.release();
    };
  }, [carId, key]);

  return values;
}

/** "1"/"true" → true, "0"/"false" → false, anything else (or invalid) → undefined. */
export function liveBool(v: QualifiedValue | undefined): boolean | undefined {
  if (!v || v.state === "invalid") return undefined;
  const t = String(v.value).trim().toLowerCase();
  if (t === "1" || t === "true") return true;
  if (t === "0" || t === "false") return false;
  return undefined;
}

export function liveNumber(v: QualifiedValue | undefined): number | undefined {
  if (!v || v.state === "invalid") return undefined;
  const n = Number(v.value);
  return Number.isFinite(n) ? n : undefined;
}
