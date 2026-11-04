// Conformance with fixtures/telemetry/cases.json: the onboard deltas each case
// expects are forwarded the way the server does (telemetry §5, `Change`) and
// applied to the client; after every tick the client must show the last sent
// value and state with the age the sender reported plus the time since.
import { describe, expect, it } from "vitest";
import { readContractJson } from "../testing/fixtures";
import { flush, setupSources } from "./testing/setup";

interface Tick { t: number; read: Record<string, [string, number, number]>; demand?: number[]; reconnect?: boolean }
interface Delta { t: number; ageMs?: number; changed: [number, string, number, number?][]; touched: number[]; touchedAged?: number[] }
interface Case { id: string; ticks: Tick[]; expect: Delta[] }

const { cases } = readContractJson<{ cases: Case[] }>("fixtures/telemetry/cases.json");

/** Server encoding of one changed entry relative to the message's default age. */
function forward(entry: [number, string, number, number?], defaultAge: number) {
  const [id, value, state, age] = entry;
  const ageMs = age ?? defaultAge;
  if (ageMs !== defaultAge) return [id, value, state, ageMs];
  return state === 0 ? [id, value] : [id, value, state];
}

const STATES = ["valid", "unchecked", "invalid", "invalid", "invalid"];

describe("telemetry fixtures through the client", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const ids = [...new Set(c.ticks.flatMap((t) => [...Object.keys(t.read).map(Number), ...(t.demand ?? [])]))];
    const env = setupSources(ids.map((id) => ({ id, channelName: `c${id}`, readIntervalTicks: 1 })));
    const car = env.sources.acquire(1);
    await flush();
    const req = car.provider.require("hud", ids.map((id) => ({ kind: "tel" as const, name: `c${id}` })));
    await flush();
    expect(env.interests().at(-1)).toEqual([...ids].sort((a, b) => a - b));

    let seq = 0;
    const last = new Map<number, { value: string; state: number; ageMs: number; at: number }>();
    for (const tick of c.ticks) {
      const now = tick.t * 1000;
      env.clock.set(now);
      if (tick.reconnect) {
        env.hub.reconnecting();
        env.hub.reconnected();
        await flush();
        last.clear();
        for (const id of ids) expect(req.source.get("tel", `c${id}`).reason, "reset after reconnect").toBe("waiting");
      }
      const delta = c.expect.find((d) => Math.abs(d.t - tick.t) < 1e-9);
      if (delta) {
        const ageMs = delta.ageMs ?? 0;
        env.hub.push("Tlm", 1, ++seq, ageMs, delta.changed.map((e) => forward(e, ageMs)), delta.touched, delta.touchedAged ?? []);
        for (const [id, value, state, age] of delta.changed) last.set(id, { value, state, ageMs: age ?? ageMs, at: now });
        for (const id of delta.touched) last.set(id, { ...last.get(id)!, ageMs, at: now });
        const aged = delta.touchedAged ?? [];
        for (let i = 0; i + 1 < aged.length; i += 2) last.set(aged[i], { ...last.get(aged[i])!, ageMs: aged[i + 1], at: now });
      }
      for (const id of ids) {
        const v = req.source.get("tel", `c${id}`);
        const l = last.get(id);
        if (!l) {
          expect(v.reason, `c${id} at ${tick.t}`).toBe("waiting");
          continue;
        }
        const age = l.ageMs + (now - l.at);
        expect(v.ageMs, `age of c${id} at ${tick.t}`).toBe(age);
        const expectedState = age > 1000 ? "invalid" : STATES[l.state];
        expect(v.state, `state of c${id} at ${tick.t}`).toBe(expectedState);
        if (v.state !== "invalid") expect(v.value).toBe(l.value);
      }
    }
    req.release();
    car.release();
  });
});
