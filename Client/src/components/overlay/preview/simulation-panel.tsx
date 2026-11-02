"use client";
// Simulation panel: design ↔ preview switch, preview time controls and the
// per-channel test values. Changes only the local PreviewSession.
import React, { useEffect, useState, useSyncExternalStore } from "react";
import type { Dependency, TelemetryDataType } from "../sources/types";
import { defaultGenerator } from "./generators";
import { DEFAULT_LIDAR_OBSTACLES } from "./lidar-synth";
import type { PreviewMessages } from "./messages";
import { PREVIEW_SPEEDS } from "./preview-clock";
import type { PreviewSession, PreviewState } from "./session";
import { simKey, type ChannelOverride, type Generator, type GeneratorKind, type LidarObstacle, type SimQuality, type SourceKind } from "./types";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const active = "px-2 py-0.5 rounded text-xs border border-sky-500 bg-sky-800 text-white";
const input = "w-16 bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-1 py-0.5";
type SimDep = { kind: SourceKind; name: string };
const QUALITIES: SimQuality[] = ["valid", "unchecked", "missing", "error", "stale"];

export function usePreviewState(session: PreviewSession): PreviewState {
  return useSyncExternalStore((l) => session.subscribe(l), () => session.getState(), () => session.getState());
}

/** Preview time rounded to 0.1 s; re-renders only when that changes. */
function useSimTime(session: PreviewSession, running: boolean): number {
  const [t, setT] = useState(() => Math.round(session.clock.now() * 10) / 10);
  useEffect(() => {
    if (!running) return;
    return session.clock.onFrame((now) => setT(Math.round(now * 10) / 10));
  }, [session, running]);
  return t;
}

function NumField({ value, onChange, title, step }: { value: number; onChange: (v: number) => void; title?: string; step?: number }) {
  return (
    <input
      className={input} type="number" title={title} aria-label={title} defaultValue={value} step={step ?? "any"}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => { const v = Number(e.target.value.replace(",", ".")); if (e.target.value !== "" && Number.isFinite(v)) onChange(v); }}
    />
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center gap-1 text-zinc-400">{label}{children}</label>;
}

function generatorFor(kind: GeneratorKind, prev: Generator, sourceKind: SourceKind, dataType: TelemetryDataType | undefined): Generator {
  const current = prev.kind === "fixed" && typeof prev.value === "number" ? prev.value : prev.kind === "slider" ? prev.value : 0;
  switch (kind) {
    case "fixed": return { kind, value: dataType === "Boolean" ? false : dataType === "String" ? "Test" : current };
    case "slider": return sourceKind === "tel" ? { kind, value: current, min: 0, max: 100, step: 1 } : { kind, value: current, min: -1, max: 1, step: 0.01 };
    case "ramp": return { kind, from: 0, to: sourceKind === "tel" ? 100 : 1, periodS: 5, shape: "saw" };
    case "sine": return { kind, offset: 0, amplitude: sourceKind === "tel" ? 50 : 1, periodS: 4 };
    case "lidar": return { kind, obstacles: DEFAULT_LIDAR_OBSTACLES.map((o) => ({ ...o })), complete: true };
  }
}

function GeneratorFields({ g, m, set, dataType }: { g: Generator; m: PreviewMessages; set: (g: Generator) => void; dataType?: TelemetryDataType }) {
  switch (g.kind) {
    case "fixed":
      if (dataType === "Boolean" || typeof g.value === "boolean") {
        return <Labeled label={m.value}><input type="checkbox" checked={g.value === true || g.value === "true"} onChange={(e) => set({ ...g, value: e.target.checked })} /></Labeled>;
      }
      return (
        <Labeled label={m.value}>
          <input className={input} defaultValue={String(g.value)} onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              const text = e.target.value;
              const n = Number(text.replace(",", "."));
              // Text that is no number stays text: it simulates an unparsable value.
              set({ ...g, value: dataType === "String" || text.trim() === "" || !Number.isFinite(n) ? text : n });
            }} />
        </Labeled>
      );
    case "slider":
      return (
        <div className="flex flex-wrap items-center gap-1">
          <input type="range" min={g.min} max={g.max} step={g.step ?? "any"} value={g.value} aria-label={m.value} onKeyDown={(e) => e.stopPropagation()} onChange={(e) => set({ ...g, value: Number(e.target.value) })} />
          <span className="tabular-nums text-zinc-200 w-12">{g.value}</span>
          <NumField title={m.min} value={g.min} onChange={(min) => set({ ...g, min })} />
          <NumField title={m.max} value={g.max} onChange={(max) => set({ ...g, max })} />
        </div>
      );
    case "ramp":
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Labeled label={m.from}><NumField value={g.from} onChange={(from) => set({ ...g, from })} /></Labeled>
          <Labeled label={m.to}><NumField value={g.to} onChange={(to) => set({ ...g, to })} /></Labeled>
          <Labeled label={m.periodS}><NumField value={g.periodS} onChange={(periodS) => set({ ...g, periodS })} /></Labeled>
          <select className={btn} aria-label={m.shape} value={g.shape ?? "saw"} onChange={(e) => set({ ...g, shape: e.target.value as "saw" | "triangle" })}>
            <option value="saw">{m.saw}</option><option value="triangle">{m.triangle}</option>
          </select>
        </div>
      );
    case "sine":
      return (
        <div className="flex flex-wrap items-center gap-1">
          <Labeled label={m.offset}><NumField value={g.offset} onChange={(offset) => set({ ...g, offset })} /></Labeled>
          <Labeled label={m.amplitude}><NumField value={g.amplitude} onChange={(amplitude) => set({ ...g, amplitude })} /></Labeled>
          <Labeled label={m.periodS}><NumField value={g.periodS} onChange={(periodS) => set({ ...g, periodS })} /></Labeled>
        </div>
      );
    case "lidar": {
      const setObstacle = (i: number, o: LidarObstacle | undefined) => {
        const obstacles = [...g.obstacles];
        if (o) obstacles[i] = o;
        else obstacles.splice(i, 1);
        set({ ...g, obstacles });
      };
      return (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={g.complete !== false} onChange={(e) => set({ ...g, complete: e.target.checked })} />{m.complete}</label>
            <Labeled label={m.rotate}><NumField value={g.rotateDegPerS ?? 0} onChange={(rotateDegPerS) => set({ ...g, rotateDegPerS })} /></Labeled>
          </div>
          {g.obstacles.map((o, i) => (
            <div key={i} className="flex flex-wrap items-center gap-1" data-ovl-sim-obstacle={i}>
              <span className="text-zinc-500">{m.obstacle} {i + 1}</span>
              <NumField title={m.angle} value={o.angleDeg} onChange={(angleDeg) => setObstacle(i, { ...o, angleDeg })} />
              <NumField title={m.width} value={o.widthDeg} onChange={(widthDeg) => setObstacle(i, { ...o, widthDeg })} />
              <NumField title={m.distance} value={o.distanceMm} onChange={(distanceMm) => setObstacle(i, { ...o, distanceMm })} />
              <NumField title={m.swing} value={o.swingMm ?? 0} onChange={(swingMm) => setObstacle(i, { ...o, swingMm, periodS: o.periodS ?? 4 })} />
              <NumField title={m.periodS} value={o.periodS ?? 4} onChange={(periodS) => setObstacle(i, { ...o, periodS })} />
              <button className={btn} title={m.remove} onClick={() => setObstacle(i, undefined)}>×</button>
            </div>
          ))}
          <button className={btn} onClick={() => set({ ...g, obstacles: [...g.obstacles, { angleDeg: 0, widthDeg: 10, distanceMm: 1000 }] })}>{m.addObstacle}</button>
        </div>
      );
    }
  }
}

function ChannelRow({ session, dep, override, implicit, m }: { session: PreviewSession; dep: SimDep; override?: ChannelOverride; implicit: boolean; m: PreviewMessages }) {
  const dataType = dep.kind === "tel" ? session.source.metadata(dep.name)?.dataType : undefined;
  const lidar = dataType === "LidarGrid";
  // "fixed" text on a LiDAR channel simulates an unreadable grid.
  const kinds: GeneratorKind[] = lidar ? ["lidar", "fixed"] : ["fixed", "slider", "ramp", "sine"];
  const set = (o: ChannelOverride | undefined) => session.setOverride(dep.kind, dep.name, o);
  const choose = (value: string) => {
    if (value === "live") return set(undefined);
    const prev = override?.generator ?? defaultGenerator(dep.kind, dataType);
    set({ ...override, generator: generatorFor(value as GeneratorKind, prev, dep.kind, dataType) });
  };
  return (
    <div className="flex flex-col gap-1 border-t border-zinc-800 pt-1" data-ovl-sim-channel={simKey(dep.kind, dep.name)}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-mono text-zinc-200">{dep.kind}(&quot;{dep.name}&quot;)</span>
        <span className={override || implicit ? "text-amber-400" : "text-emerald-400"}>{override || implicit ? m.simulated : m.live}</span>
        <select className={btn} aria-label={m.simulation} value={override?.generator.kind ?? "live"} onChange={(e) => choose(e.target.value)}>
          <option value="live">{implicit ? `${m.simulated} (${m.simulateAll})` : m.live}</option>
          {kinds.map((k) => <option key={k} value={k}>{m.generators[k]}</option>)}
        </select>
      </div>
      {override && (
        <>
          <GeneratorFields key={override.generator.kind} g={override.generator} m={m} dataType={dataType} set={(generator) => set({ ...override, generator })} />
          <div className="flex flex-wrap items-center gap-1">
            <select className={btn} aria-label={m.quality} value={override.quality ?? "valid"} onChange={(e) => set({ ...override, quality: e.target.value as SimQuality })}>
              {QUALITIES.map((q) => <option key={q} value={q}>{m.qualities[q]}</option>)}
            </select>
            {dep.kind === "tel" && <Labeled label={m.ageMs}><NumField value={override.ageMs ?? 0} onChange={(ageMs) => set({ ...override, ageMs })} /></Labeled>}
            {dep.kind !== "tel" && (
              <label className="flex items-center gap-1 text-zinc-400"><input type="checkbox" checked={override.paused === true} onChange={(e) => set({ ...override, paused: e.target.checked })} />{m.paused}</label>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export interface SimulationPanelProps {
  session: PreviewSession;
  m: PreviewMessages;
  /** Values the HUD needs (runtime dependencies of the effective configuration). */
  dependencies: Dependency[];
}

export function SimulationPanel({ session, m, dependencies: all }: SimulationPanelProps) {
  const dependencies = all.filter((d): d is SimDep => d.kind !== "driver");
  const usesDriver = all.some((d) => d.kind === "driver");
  const state = usePreviewState(session);
  const preview = state.mode === "preview";
  const time = useSimTime(session, preview && !state.paused);
  const { overrides, simulateAll, driverActive } = state.settings;
  // Overrides of values the HUD no longer uses stay listed so they can be removed.
  const listed = new Map<string, SimDep>(dependencies.map((d) => [simKey(d.kind, d.name), d]));
  for (const key of Object.keys(overrides)) {
    const i = key.indexOf(":");
    if (!listed.has(key)) listed.set(key, { kind: key.slice(0, i) as SourceKind, name: key.slice(i + 1) });
  }
  return (
    <div className="flex flex-col gap-2 text-xs text-zinc-300" data-ovl-simulation="" data-ovl-preview-mode={state.mode}>
      <div className="flex items-center gap-1" role="group">
        <button className={preview ? btn : active} aria-pressed={!preview} onClick={() => session.leavePreview()}>{m.design}</button>
        <button className={preview ? active : btn} aria-pressed={preview} onClick={() => session.enterPreview()}>{m.preview}</button>
      </div>
      <div className="font-semibold text-zinc-400">{m.simulation}</div>
      <div className="flex flex-wrap items-center gap-1" data-ovl-sim-time="">
        {state.paused
          ? <button className={btn} disabled={!preview} onClick={() => session.play()}>▶ {m.play}</button>
          : <button className={btn} disabled={!preview} onClick={() => session.pause()}>❚❚ {m.pause}</button>}
        <button className={btn} disabled={!preview} onClick={() => session.step()}>{m.step}</button>
        <button className={btn} disabled={!preview} onClick={() => session.step(1)}>{m.stepSecond}</button>
        <button className={btn} disabled={!preview} onClick={() => session.restart()}>↺ {m.restart}</button>
        <select className={btn} aria-label={m.speed} value={state.speed} onChange={(e) => session.setSpeed(Number(e.target.value))}>
          {PREVIEW_SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <span className="tabular-nums text-zinc-400">{m.time} {(state.paused ? Math.round(session.clock.now() * 10) / 10 : time).toFixed(1)} s</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1" title={m.simulateAllHint}>
          <input type="checkbox" checked={simulateAll} onChange={(e) => session.setSimulateAll(e.target.checked)} />{m.simulateAll}
        </label>
        <button className={btn} onClick={() => session.clearSimulation()}>{m.clear}</button>
      </div>
      {usesDriver && (
        <Labeled label={m.driverActive}>
          <select className={btn} value={driverActive === undefined ? "live" : String(driverActive)}
            onChange={(e) => session.setDriverActive(e.target.value === "live" ? undefined : e.target.value === "true")}>
            <option value="live">{m.live}</option><option value="true">{m.yes}</option><option value="false">{m.no}</option>
          </select>
        </Labeled>
      )}
      <div className="font-semibold text-zinc-400">{m.channels}</div>
      {listed.size === 0 && <div className="text-zinc-500">{m.noChannels}</div>}
      {[...listed.entries()].map(([key, dep]) => (
        <ChannelRow key={key} session={session} dep={dep} override={overrides[key]} implicit={!overrides[key] && simulateAll && dependencies.some((d) => simKey(d.kind, d.name) === key)} m={m} />
      ))}
      <div className="text-zinc-500">{m.localOnly}</div>
    </div>
  );
}
