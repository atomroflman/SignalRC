import React, { useCallback, useEffect, useState } from "react";
import { CarAudioSettings } from "@/components/audio-store";
import { LevelMeter, dbToLevel } from "@/components/level-meter";
import { useI18n } from "@/i18n/provider";
import {
  AudioDevice, AudioDeviceKind, deviceLabel, isDetected, isHdmi, otherDevices, preselectedDevice,
  recommendedDevices, suggestedDevices,
} from "./audio-device-model";

type TestResult = { ok: boolean; message: string; peakDb?: number | null; rmsDb?: number | null };
type ScanState = "scanning" | "live" | "cached";

const BITRATES_KBPS = [16, 24, 32, 48, 64, 96];
const CHANNELS: CarAudioSettings["inputChannel"][] = ["mix", "left", "right"];

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";
const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800 disabled:opacity-40 disabled:cursor-not-allowed";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed";
const btnDanger = "px-2 py-1 bg-red-950 hover:bg-red-900 text-red-100 rounded text-xs border border-red-900";

const percent = (value: number) => `${Math.round(value * 100)} %`;

function KindIcon({ kind }: { kind: AudioDeviceKind }) {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-zinc-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "input" ? (
        <>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </>
      ) : (
        <>
          <path d="M4 10v4h4l5 4V6L8 10H4z" />
          <path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}

function TestResultView({ result }: { result: TestResult }) {
  const { messages } = useI18n();
  const m = messages.setupPage.audio;
  return (
    <div role="status" className={`mt-2 p-2 rounded border text-xs ${result.ok ? "border-green-900 bg-green-950/40 text-green-100" : "border-red-900 bg-red-950/40 text-red-100"}`}>
      <div>{result.message}</div>
      {result.peakDb != null && (
        <div className="mt-1 space-y-1">
          <LevelMeter level={dbToLevel(result.peakDb)} label={m.peak} />
          <div className="text-[10px] text-zinc-400">{m.levelValues(result.peakDb, result.rmsDb ?? null)}</div>
        </div>
      )}
    </div>
  );
}

function useDeviceTest(carId: number) {
  const { messages } = useI18n();
  const [testing, setTesting] = useState<string | null>(null);
  const [result, setResult] = useState<(TestResult & { device: string }) | null>(null);

  const run = useCallback(async (device: string, kind: AudioDeviceKind) => {
    setTesting(device);
    setResult(null);
    try {
      const r = await fetch(`/api/cars/${carId}/channels/audio-device-test`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device, output: kind === "output" }),
      });
      const body: TestResult = r.ok ? await r.json() : { ok: false, message: await r.text() };
      setResult({ ...body, device });
    } catch {
      setResult({ ok: false, message: messages.setupPage.audio.testUnreachable, device });
    } finally {
      setTesting(null);
    }
  }, [carId, messages.setupPage.audio.testUnreachable]);

  return { testing, result, run, clear: () => setResult(null) };
}

function DeviceOption({ device, selected, name, onSelect }: { device: AudioDevice; selected: boolean; name: string; onSelect: () => void }) {
  const { messages } = useI18n();
  return (
    <label className={`flex items-center gap-2 p-2 rounded border cursor-pointer ${selected ? "border-green-700 bg-green-950/30" : "border-zinc-700 bg-zinc-900 hover:bg-zinc-800"}`}>
      <input type="radio" name={name} checked={selected} onChange={onSelect} className="accent-green-600" />
      <span className="min-w-0">
        <span className="block text-zinc-100">
          {device.description?.split(",")[0]?.trim() || device.name}
          {isHdmi(device) && <span className="ml-2 text-[10px] text-amber-300">{messages.setupPage.audio.hdmiHint}</span>}
        </span>
        <span className="block font-mono text-[10px] text-zinc-500 break-all">{device.name}</span>
      </span>
    </label>
  );
}

function DeviceEditor({ carId, kind, devices, initial, onSave, onCancel }: {
  carId: number;
  kind: AudioDeviceKind;
  devices: AudioDevice[];
  initial: CarAudioSettings;
  onSave: (settings: CarAudioSettings) => Promise<void>;
  onCancel: () => void;
}) {
  const { messages } = useI18n();
  const m = messages.setupPage.audio;
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const { testing, result, run, clear } = useDeviceTest(carId);

  const device = (kind === "input" ? draft.inputDevice : draft.outputDevice) ?? "";
  const setDevice = (name: string) => {
    clear();
    setDraft(prev => kind === "input" ? { ...prev, inputDevice: name } : { ...prev, outputDevice: name });
  };
  const recommended = recommendedDevices(devices);
  const others = otherDevices(devices);
  const isListed = recommended.some(d => d.name === device);
  const [showOther, setShowOther] = useState(!!device && !isListed);
  const groupName = `audio-device-${kind}`;

  return (
    <div className="p-3 space-y-3 border border-zinc-700 rounded bg-zinc-950 text-xs">
      <div className="flex items-center gap-2 text-zinc-100">
        <KindIcon kind={kind} />
        <span>{kind === "input" ? m.microphone : m.speaker}</span>
        <span className="text-zinc-500">{kind === "input" ? m.inputDirection : m.outputDirection}</span>
      </div>

      <fieldset className="space-y-1">
        <legend className="mb-1 text-zinc-400">{m.device}</legend>
        {recommended.map(d => (
          <DeviceOption key={d.name} device={d} name={groupName} selected={device === d.name} onSelect={() => { setShowOther(false); setDevice(d.name); }} />
        ))}
        {recommended.length === 0 && <div className="p-2 rounded border border-amber-900 bg-amber-950/30 text-amber-200">{m.noneDetected(kind)}</div>}
        <button type="button" className="text-sky-400 hover:underline text-[11px]" aria-expanded={showOther} onClick={() => setShowOther(s => !s)}>
          {showOther ? m.hideOtherNames : m.showOtherNames}
        </button>
        {showOther && (
          <div className="space-y-1">
            <input
              className={inputClass + " font-mono w-full"}
              value={device}
              onChange={e => setDevice(e.target.value)}
              placeholder="plughw:CARD=Device,DEV=0"
              aria-label={m.manualName}
            />
            {others.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {others.map(d => (
                  <button type="button" key={d.name} title={d.description ?? undefined} className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 font-mono text-[10px] text-zinc-300" onClick={() => setDevice(d.name)}>{d.name}</button>
                ))}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <div>
        <button type="button" className={btnGhost} disabled={!device.trim() || testing != null} onClick={() => run(device.trim(), kind)}>
          {testing ? m.testing : kind === "input" ? m.testRecord : m.testTone}
        </button>
        {result && result.device === device.trim() && <TestResultView result={result} />}
      </div>

      {kind === "input" ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <fieldset>
            <legend className="mb-1 text-zinc-400">{m.channel}</legend>
            <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
              {CHANNELS.map(c => (
                <label key={c} className={`px-2 py-1 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-sky-500 ${draft.inputChannel === c ? "bg-green-900 text-green-100" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                  <input type="radio" className="sr-only" name={`${groupName}-channel`} checked={draft.inputChannel === c} onChange={() => setDraft(p => ({ ...p, inputChannel: c }))} />
                  {m.channels[c]}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.bitrate}</span>
            <select className={inputClass + " w-fit"} value={draft.bitrateKbps} onChange={e => setDraft(p => ({ ...p, bitrateKbps: Number(e.target.value) }))}>
              {BITRATES_KBPS.map(b => <option key={b} value={b}>{b} kbit/s</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.gain}: <span className="text-zinc-100">{percent(draft.inputGain)}</span></span>
            <input type="range" min={0} max={4} step={0.05} value={draft.inputGain} onChange={e => setDraft(p => ({ ...p, inputGain: Number(e.target.value) }))} className="accent-green-600" />
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-green-600" checked={draft.denoise} onChange={e => setDraft(p => ({ ...p, denoise: e.target.checked }))} />
            <span><span className="block text-zinc-200">{m.denoise}</span><span className="text-[10px] text-zinc-500">{m.denoiseHint}</span></span>
          </label>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-zinc-400">{m.volume}: <span className="text-zinc-100">{percent(draft.outputVolume)}</span></span>
            <input type="range" min={0} max={2} step={0.05} value={draft.outputVolume} onChange={e => setDraft(p => ({ ...p, outputVolume: Number(e.target.value) }))} className="accent-green-600" />
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 accent-green-600" checked={draft.muteInputWhileTalking} onChange={e => setDraft(p => ({ ...p, muteInputWhileTalking: e.target.checked }))} />
            <span><span className="block text-zinc-200">{m.muteWhileTalking}</span><span className="text-[10px] text-zinc-500">{m.muteWhileTalkingHint}</span></span>
          </label>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" className={btnGhost} onClick={onCancel}>{m.cancel}</button>
        <button
          type="button"
          className={btnPrimary}
          disabled={!device.trim() || saving}
          onClick={async () => {
            setSaving(true);
            try { await onSave(draft); } finally { setSaving(false); }
          }}
        >
          {saving ? m.saving : m.save}
        </button>
      </div>
    </div>
  );
}

function DeviceRow({ carId, kind, device, devices, scan, summary, onEdit, onDelete }: {
  carId: number;
  kind: AudioDeviceKind;
  device: string;
  devices: AudioDevice[];
  scan: ScanState;
  summary: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { messages } = useI18n();
  const m = messages.setupPage.audio;
  const { testing, result, run } = useDeviceTest(carId);
  const detected = isDetected(devices, device);
  // Only a live answer proves a device is gone; an old list may just predate it.
  const missing = !detected && scan === "live";
  return (
    <div className="border border-zinc-800 rounded p-2 bg-zinc-900 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KindIcon kind={kind} />
          <div className="min-w-0">
            <div className="text-zinc-100">
              {kind === "input" ? m.microphone : m.speaker}
              <span className="text-zinc-400 ml-2">{deviceLabel(devices, device)}</span>
            </div>
            <div className="font-mono text-[10px] text-zinc-500 break-all">{device}</div>
            <div className="text-[10px] text-zinc-400">{summary}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {scan !== "scanning" && (
            <span className={`mr-1 inline-flex items-center gap-1 text-[10px] ${missing ? "text-red-300" : detected ? "text-green-300" : "text-zinc-400"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${missing ? "bg-red-500" : detected ? "bg-green-500" : "bg-zinc-500"}`} />
              {missing ? m.statusMissing : detected ? m.statusDetected : m.statusUnknown}
            </span>
          )}
          <button type="button" className={btnGhost} disabled={testing != null} onClick={() => run(device, kind)}>
            {testing ? m.testing : m.test}
          </button>
          <button type="button" className={btnGhost} onClick={onEdit}>{m.edit}</button>
          <button type="button" className={btnDanger} onClick={onDelete}>{m.remove}</button>
        </div>
      </div>
      {result && <TestResultView result={result} />}
    </div>
  );
}

/**
 * Vehicle audio devices as a list like the channels: add, edit, test, remove. A vehicle has one
 * microphone and one speaker (SignalRC.Shared.Audio.AudioSettings); a second entry of a kind can't exist.
 */
export default function AudioDeviceManager({ carId, settings, onSaved }: {
  carId: number;
  settings: CarAudioSettings;
  onSaved: (settings: CarAudioSettings) => void;
}) {
  const { messages } = useI18n();
  const m = messages.setupPage.audio;
  const [inputs, setInputs] = useState<AudioDevice[]>([]);
  const [outputs, setOutputs] = useState<AudioDevice[]>([]);
  const [scan, setScan] = useState<ScanState>("scanning");
  const [editing, setEditing] = useState<{ kind: AudioDeviceKind; draft: CarAudioSettings } | null>(null);

  const rescan = useCallback(async () => {
    setScan("scanning");
    try {
      const r = await fetch(`/api/cars/${carId}/channels/available-audio-devices/scan`, { method: "POST" });
      const body = r.ok ? await r.json() : null;
      setInputs(Array.isArray(body?.inputs) ? body.inputs : []);
      setOutputs(Array.isArray(body?.outputs) ? body.outputs : []);
      setScan(body?.live ? "live" : "cached");
    } catch {
      setScan("cached");
    }
  }, [carId]);

  useEffect(() => { void rescan(); }, [rescan]);

  const save = async (next: CarAudioSettings) => {
    const r = await fetch(`/api/cars/${carId}/channels/audio-settings`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
    });
    if (!r.ok) { alert(await r.text()); return; }
    onSaved({ ...settings, ...(await r.json()) });
    setEditing(null);
  };

  const add = (kind: AudioDeviceKind, device?: string) => {
    const list = kind === "input" ? inputs : outputs;
    const name = device ?? preselectedDevice(list);
    setEditing({ kind, draft: kind === "input" ? { ...settings, inputDevice: name } : { ...settings, outputDevice: name } });
  };

  const remove = (kind: AudioDeviceKind) => {
    if (!confirm(kind === "input" ? m.confirmRemoveMicrophone : m.confirmRemoveSpeaker)) return;
    void save(kind === "input" ? { ...settings, inputDevice: null } : { ...settings, outputDevice: null });
  };

  const suggestions: { kind: AudioDeviceKind; device: AudioDevice }[] = editing ? [] : [
    ...suggestedDevices(inputs, "input", settings.inputDevice).map(device => ({ kind: "input" as const, device })),
    ...suggestedDevices(outputs, "output", settings.outputDevice).map(device => ({ kind: "output" as const, device })),
  ];
  const isEditing = (kind: AudioDeviceKind) => editing?.kind === kind;
  const inputSummary = m.inputSummary(m.channels[settings.inputChannel], settings.bitrateKbps, percent(settings.inputGain), settings.denoise);
  const outputSummary = m.outputSummary(percent(settings.outputVolume), settings.muteInputWhileTalking);

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!!settings.inputDevice || !!editing} title={settings.inputDevice ? m.oneMicrophone : undefined} onClick={() => add("input")}>{m.addMicrophone}</button>
        <button type="button" className={btnPrimary} disabled={!!settings.outputDevice || !!editing} title={settings.outputDevice ? m.oneSpeaker : undefined} onClick={() => add("output")}>{m.addSpeaker}</button>
        <button type="button" className={btnGhost} disabled={scan === "scanning"} onClick={() => void rescan()}>{scan === "scanning" ? m.scanning : m.rescan}</button>
        <span className="text-[10px] text-zinc-500" role="status">
          {scan === "live" ? m.scanLive : scan === "cached" ? m.scanCached : ""}
        </span>
      </div>

      {suggestions.map(({ kind, device }) => (
        <div key={`${kind}:${device.name}`} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded border border-sky-900 bg-sky-950/40 text-sky-100">
          <span className="flex items-center gap-2 min-w-0">
            <KindIcon kind={kind} />
            <span className="min-w-0">{m.suggestion(deviceLabel(kind === "input" ? inputs : outputs, device.name))}</span>
          </span>
          <button type="button" className={btnPrimary} onClick={() => add(kind, device.name)}>{kind === "input" ? m.useAsMicrophone : m.useAsSpeaker}</button>
        </div>
      ))}

      {!settings.inputDevice && !settings.outputDevice && !editing && suggestions.length === 0 && scan !== "scanning" && (
        <div className="p-3 rounded border border-dashed border-zinc-700 text-zinc-400">
          {scan === "live" ? m.emptyLive : m.emptyOffline}
        </div>
      )}

      {settings.inputDevice && !isEditing("input") && (
        <DeviceRow carId={carId} kind="input" device={settings.inputDevice} devices={inputs} scan={scan} summary={inputSummary} onEdit={() => setEditing({ kind: "input", draft: settings })} onDelete={() => remove("input")} />
      )}
      {isEditing("input") && (
        <DeviceEditor carId={carId} kind="input" devices={inputs} initial={editing!.draft} onSave={save} onCancel={() => setEditing(null)} />
      )}
      {settings.outputDevice && !isEditing("output") && (
        <DeviceRow carId={carId} kind="output" device={settings.outputDevice} devices={outputs} scan={scan} summary={outputSummary} onEdit={() => setEditing({ kind: "output", draft: settings })} onDelete={() => remove("output")} />
      )}
      {isEditing("output") && (
        <DeviceEditor carId={carId} kind="output" devices={outputs} initial={editing!.draft} onSave={save} onCancel={() => setEditing(null)} />
      )}
    </div>
  );
}
