import React, { useContext, useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import CollapsibleSection from "@/components/collapsible-section";
import ConfigHeader from "@/components/config-header";
import ConfigGuard from "@/components/config-guard";
import { useI18n } from "@/i18n/provider";
import { CarAudioSettings, DEFAULT_CAR_AUDIO_SETTINGS } from "@/components/audio-store";
import AudioChat from "@/components/audio-chat";
import CarVideoPanel from "@/components/car-video-panel";
import OnboardDiagnostics from "@/components/onboard-diagnostics";
import VehicleAudio from "@/components/vehicle-audio";
import AudioDeviceManager from "@/components/setup/audio-device-manager";
import ControlTestPanel from "@/components/setup/control-test-panel";
import TelemetryTestPanel from "@/components/setup/telemetry-test-panel";
import LidarSourceSetup from "@/components/overlay/lidar-source/lidar-source-setup";
import { confirmationText, dependencyWarning, loadChannelDependencies } from "@/components/overlay/integration/channel-dependencies";
import OptionsJsonField from "@/components/config/options-json-field";
import { findSchema, parseOptionSchemas, type ChannelTypeSchema, type SchemaKind } from "@/components/config/options-language";
import { suggestTelemetryValue } from "@/components/config/telemetry-value-hint";
import WiringPanel from "@/components/config/pin-boards/wiring-panel";
import { downloadVehicleConfig } from "@/components/setup/config-export";
import { ConfigImportButton } from "@/components/setup/config-import-dialog";
import PinBoardEditor, { boardKindOf, type NewChannelRequest, type OtherPinManager } from "@/components/config/pin-boards/pin-board-editor";
import type { ChannelRef } from "@/components/config/pin-boards/pin-boards";

type PinManager = {
  name: string;
  type: string;
  optionsJson: string;
  modifiedAt?: string | null;
};

type ControlChannel = {
  channelName: string;
  displayName?: string | null;
  isEnabled: boolean;
  requiresAxis: boolean;
  maxResendInterval?: number | null;
  controlType: string;
  pinManager: string;
  address?: number | null;
  testDisabled: boolean;
  optionsJson: string;
  modifiedAt?: string | null;
};

type TelemetryChannel = {
  channelName: string;
  readIntervalTicks: number;
  telemetryType: string;
  dataType: number;
  unit?: string | null;
  decimals?: number | null;
  pinManager?: string | null;
  address?: number | null;
  optionsJson: string;
  modifiedAt?: string | null;
};

type VideoStream = {
  streamId: string;
  name?: string | null;
  type?: string | null;
  location?: string | null;
  enabled: boolean;
  width?: number | null;
  height?: number | null;
  framerate?: number | null;
  bitrateKbps?: number | null;
  cameraDevice?: string | null;
  rpiCamId?: number | null;
  priority?: number | null;
  optionsJson: string;
  modifiedAt?: string | null;
};


/** One problem the onboard reported (Shared/Channels/ChannelHealth.cs); OK channels have none. */
type HealthEntry = { kind: "pinManager" | "control" | "telemetry" | "video"; name: string; state: "warning" | "error"; message: string; sinceUtc: string };
/** entries is null while the vehicle is offline or its onboard build does not report health. */
type Health = { connected: boolean; entries: HealthEntry[] | null };
const HEALTH_POLL_MS = 3000;

type Template = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  version?: string | null;
  author?: string | null;
  channelMapHash?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

// Index = TelemetryDataType (Shared/Channels/TelemetryDataType.cs); 4 = compact LiDAR grid (AP04).
const DATA_TYPES = ["String", "Integer", "Float", "Boolean", "LidarGrid"];

function Field({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-zinc-300 ${className ?? ""}`}>
      <span className="text-zinc-400">{label}</span>
      {children}
      {hint && <span className="text-zinc-500 text-[10px]">{hint}</span>}
    </label>
  );
}

const inputClass = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";

// The onboard reads telemetry every n-th tick of its 100 ms loop; the editor speaks milliseconds.
const TICK_MS = 100;
const msToTicks = (ms: number) => Math.max(1, Math.round(ms / TICK_MS));

/** Read interval edited in ms, stored as ticks; converted when the field loses focus. */
function ReadIntervalInput({ ticks, onChange }: { ticks: number; onChange: (ticks: number) => void }) {
  const [text, setText] = useState(String(ticks * TICK_MS));
  useEffect(() => { setText(String(ticks * TICK_MS)); }, [ticks]);
  const commit = () => {
    const ms = Number(text);
    if (!Number.isFinite(ms) || ms <= 0) { setText(String(ticks * TICK_MS)); return; }
    const next = msToTicks(ms);
    setText(String(next * TICK_MS));
    if (next !== ticks) onChange(next);
  };
  return (
    <input className={inputClass} type="number" min={TICK_MS} step={TICK_MS} value={text}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === "Enter") commit(); }} />
  );
}
const btnPrimary = "px-2 py-1 bg-green-900 hover:bg-green-800 text-green-100 rounded text-xs border border-green-800";
const btnDanger = "px-2 py-1 bg-red-900 hover:bg-red-800 text-red-100 rounded text-xs border border-red-800";
const btnGhost = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";

/** The onboard's verdict on one config row: nothing when OK, else state and message. */
function HealthLine({ entry, carId }: { entry?: HealthEntry; carId?: number }) {
  if (!entry) return null;
  const error = entry.state === "error";
  return (
    <div className={`mt-1 text-[11px] font-mono break-words ${error ? "text-red-300" : "text-amber-300"}`}>
      <span className={`inline-block px-1 mr-2 rounded border ${error ? "border-red-800 bg-red-950" : "border-amber-800 bg-amber-950"}`}>
        {error ? "error" : "warning"}
      </span>
      {entry.message}
      <Link href={`/car/${carId}/logs?q=${encodeURIComponent(entry.name)}`} className="ml-2 text-blue-400 hover:underline">log</Link>
    </div>
  );
}

/** Summary above the sections: offline, no report, or how many rows have problems. */
function HealthSummary({ health }: { health: Health | null }) {
  if (!health) return null;
  if (!health.connected)
    return <div className="mb-3 text-xs text-zinc-400 border border-zinc-800 rounded p-2">Vehicle offline: no channel status. Changes are applied when it connects.</div>;
  if (!health.entries)
    return <div className="mb-3 text-xs text-zinc-400 border border-zinc-800 rounded p-2">The onboard does not report channel status (older build).</div>;
  const errors = health.entries.filter(e => e.state === "error").length;
  const warnings = health.entries.length - errors;
  if (health.entries.length === 0)
    return <div className="mb-3 text-xs text-green-300 border border-green-900 rounded p-2">All channels running on the vehicle.</div>;
  return (
    <div className={`mb-3 text-xs rounded p-2 border ${errors > 0 ? "text-red-200 border-red-800 bg-red-950/40" : "text-amber-200 border-amber-800 bg-amber-950/40"}`}>
      {errors > 0 && <span className="mr-3">{errors} channel{errors === 1 ? "" : "s"} not running</span>}
      {warnings > 0 && <span>{warnings} warning{warnings === 1 ? "" : "s"}</span>}
      <span className="text-zinc-400 ml-3">Details at the affected entries below.</span>
    </div>
  );
}

/** Option schemas reported by the vehicle and the configured pin manager names, for the options fields. */
const OptionsInfo = React.createContext<{ schemas: ChannelTypeSchema[]; pinManagers: string[] }>({ schemas: [], pinManagers: [] });

/** The options field of an editor: schema of the chosen type, its description as hint. */
function OptionsField({ kind, typeName, value, onChange, example, className }: {
  kind: SchemaKind; typeName: string | null | undefined; value: string; onChange: (text: string) => void; example: string; className?: string;
}) {
  const { schemas, pinManagers } = useContext(OptionsInfo);
  const schema = findSchema(schemas, kind, typeName);
  const hint = schema
    ? `${schema.description ? `${schema.description} ` : ""}${schema.options.length} options · Ctrl+Space to complete`
    : schemas.length > 0 && typeName ? `No options known for ${typeName}. ${example}` : example;
  return (
    <Field label="Options (JSON)" hint={hint} className={className}>
      <OptionsJsonField value={value} onChange={onChange} schema={schema} pinManagers={pinManagers} />
    </Field>
  );
}

function parseOptionsJson(json: string): any {
  if (!json || !json.trim()) return undefined;
  try { return JSON.parse(json); }
  catch { return undefined; }
}

function formatOptionsJson(options: any): string {
  if (!options || typeof options !== "object" || Object.keys(options).length === 0) return "";
  try { return JSON.stringify(options, null, 2); }
  catch { return ""; }
}

/** What the board editors need from the page: channels on the pins, the other managers, the vehicle's board. */
type BoardContext = {
  carId: number;
  channels: ChannelRef[];
  pinManagers: PinManager[];
  boardModel: string | null;
  onCreateChannel: (request: NewChannelRequest) => void;
};

function PinManagerEditor({
  initial, isNew, onSave, onCancel, board,
}: { initial?: PinManager; isNew: boolean; onSave: (p: PinManager) => Promise<void>; onCancel: () => void; board: BoardContext }) {
  const [p, setP] = useState<PinManager>(initial ?? { name: "", type: "", optionsJson: "" });
  const update = (patch: Partial<PinManager>) => setP(prev => ({ ...prev, ...patch }));
  const kind = boardKindOf(p.type);
  const options = useMemo(() => {
    if (!p.optionsJson.trim()) return {};
    try {
      const o = JSON.parse(p.optionsJson);
      return o && typeof o === "object" && !Array.isArray(o) ? o as Record<string, unknown> : undefined;
    } catch { return undefined; }
  }, [p.optionsJson]);
  const others = useMemo<OtherPinManager[]>(() => board.pinManagers
    .filter(m => m.name !== p.name)
    .map(m => ({ name: m.name, type: m.type, options: parseOptionsJson(m.optionsJson) })), [board.pinManagers, p.name]);
  return (
    <div className="grid grid-cols-2 gap-2 p-2 border border-zinc-700 rounded bg-zinc-950">
      <Field label="Name"><input className={inputClass} value={p.name} onChange={e => update({ name: e.target.value })} disabled={!isNew} /></Field>
      <Field label="Type"><input className={inputClass} value={p.type} onChange={e => update({ type: e.target.value })} list="pin-manager-type-options" placeholder="e.g. Pca9685PwmExtension" /></Field>
      {kind && (
        <div className="col-span-2">
          <PinBoardEditor carId={board.carId} managerName={p.name || "default"} kind={kind} options={options}
            onOptionsChange={o => update({ optionsJson: formatOptionsJson(o) })}
            channels={board.channels} otherPinManagers={others} boardModel={board.boardModel} onCreateChannel={board.onCreateChannel} />
        </div>
      )}
      <OptionsField kind="pinManager" typeName={p.type} value={p.optionsJson} onChange={optionsJson => update({ optionsJson })} example='e.g. {"boardAddress":0,"i2cBus":1}' className="col-span-2" />
      <div className="col-span-2 flex gap-2 justify-end">
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        <button className={btnPrimary} onClick={() => onSave(p)}>Save</button>
      </div>
    </div>
  );
}

type SoundFile = { name: string; sizeBytes: number; sha256: string; uploadedAt?: string };

const SOUND_EXTENSIONS = [".mp3", ".wav", ".ogg", ".oga", ".opus", ".flac", ".m4a", ".aac", ".webm"];

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Structured view of a SoundPlayer channel's options; edits the same JSON as the raw field below it.
function SoundPlayerOptionsEditor({
  optionsJson, onChange, soundFiles, hasSpeaker,
}: { optionsJson: string; onChange: (json: string) => void; soundFiles: SoundFile[]; hasSpeaker: boolean }) {
  const options: Record<string, any> = parseOptionsJson(optionsJson) ?? {};
  const set = (key: string, value: unknown) => {
    const next = { ...options };
    if (value === undefined || value === "" || value === null) delete next[key];
    else next[key] = value;
    onChange(formatOptionsJson(next));
  };
  const num = (value: string) => (value === "" ? undefined : Number(value));
  const mode = options.mode ?? "toEnd";
  const fileNames = soundFiles.map(f => f.name);
  return (
    <div className="col-span-2 grid grid-cols-2 gap-2 p-2 border border-sky-900 rounded bg-sky-950/30">
      <div className="col-span-2 text-sky-200">Sound</div>
      {!hasSpeaker && <div className="col-span-2 text-amber-400">No speaker configured for this vehicle (Audio tab) — the channel stays silent.</div>}
      <Field label="File" className="col-span-2">
        <select className={inputClass} value={options.file ?? ""} onChange={e => set("file", e.target.value)}>
          <option value="">-- select sound --</option>
          {fileNames.map(name => <option key={name} value={name}>{name}</option>)}
          {options.file && !fileNames.includes(options.file) && <option value={options.file}>{options.file} (missing)</option>}
        </select>
      </Field>
      <Field label="Mode">
        <select className={inputClass} value={mode} onChange={e => set("mode", e.target.value === "toEnd" ? undefined : e.target.value)}>
          <option value="toEnd">Press: play to end</option>
          <option value="hold">Hold: play while pressed</option>
          <option value="toggle">Toggle: press to start/stop</option>
        </select>
      </Field>
      <Field label="Press while playing" hint="Only for 'play to end'">
        <select className={inputClass} value={options.retrigger ?? "restart"} disabled={mode !== "toEnd"} onChange={e => set("retrigger", e.target.value === "restart" ? undefined : e.target.value)}>
          <option value="restart">Restart</option>
          <option value="ignore">Ignore</option>
          <option value="stop">Stop</option>
        </select>
      </Field>
      <Field label={`Volume: ${options.volumePercent ?? 100} %`}>
        <input type="range" min={0} max={200} step={5} value={options.volumePercent ?? 100} onChange={e => set("volumePercent", Number(e.target.value) === 100 ? undefined : Number(e.target.value))} />
      </Field>
      <Field label="Loop"><input type="checkbox" checked={!!options.loop} onChange={e => set("loop", e.target.checked || undefined)} /></Field>
      <Field label="Start (s)"><input className={inputClass} type="number" min={0} step={0.1} value={options.startSeconds ?? ""} onChange={e => set("startSeconds", num(e.target.value))} /></Field>
      <Field label="End (s)" hint="empty = end of file"><input className={inputClass} type="number" min={0} step={0.1} value={options.endSeconds ?? ""} onChange={e => set("endSeconds", num(e.target.value))} /></Field>
      <Field label="Fade in (ms)"><input className={inputClass} type="number" min={0} step={10} value={options.fadeInMs ?? ""} onChange={e => set("fadeInMs", num(e.target.value))} /></Field>
      <Field label="Fade out (ms)" hint="when stopped early"><input className={inputClass} type="number" min={0} step={10} value={options.fadeOutMs ?? ""} onChange={e => set("fadeOutMs", num(e.target.value))} /></Field>
      <Field label="Quieter during push-to-talk"><input type="checkbox" checked={!!options.duckOnTalk} onChange={e => set("duckOnTalk", e.target.checked || undefined)} /></Field>
    </div>
  );
}

function ControlEditor({
  initial, isNew, onSave, onCancel, controlTypes, soundFiles, hasSpeaker,
}: { initial?: ControlChannel; isNew: boolean; onSave: (c: ControlChannel) => Promise<void>; onCancel: () => void; controlTypes: string[]; soundFiles: SoundFile[]; hasSpeaker: boolean }) {
  const [c, setC] = useState<ControlChannel>(initial ?? {
    channelName: "", displayName: "", isEnabled: true, requiresAxis: false, maxResendInterval: null,
    controlType: "", pinManager: "default", address: null, testDisabled: false, optionsJson: "",
  });
  const update = (patch: Partial<ControlChannel>) => setC(prev => ({ ...prev, ...patch }));
  return (
    <div id={isNew ? "new-control-editor" : undefined} className="grid grid-cols-2 gap-2 p-2 border border-zinc-700 rounded bg-zinc-950">
      <Field label="Channel name"><input className={inputClass} value={c.channelName} onChange={e => update({ channelName: e.target.value })} disabled={!isNew} /></Field>
      <Field label="Display name"><input className={inputClass} value={c.displayName ?? ""} onChange={e => update({ displayName: e.target.value })} /></Field>
      <Field label="Control type">
        <input className={inputClass} value={c.controlType} onChange={e => update({ controlType: e.target.value })} list="control-type-options" placeholder="e.g. Steering, PwmLight" />
      </Field>
      <Field label="Pin manager"><input className={inputClass} value={c.pinManager} onChange={e => update({ pinManager: e.target.value })} list="pin-manager-options" /></Field>
      <Field label="Address (int)"><input className={inputClass} type="number" value={c.address ?? ""} onChange={e => update({ address: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Max resend interval (ms)"><input className={inputClass} type="number" value={c.maxResendInterval ?? ""} onChange={e => update({ maxResendInterval: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Enabled"><input type="checkbox" checked={c.isEnabled} onChange={e => update({ isEnabled: e.target.checked })} /></Field>
      <Field label="Requires axis"><input type="checkbox" checked={c.requiresAxis} onChange={e => update({ requiresAxis: e.target.checked })} /></Field>
      <Field label="Test disabled"><input type="checkbox" checked={c.testDisabled} onChange={e => update({ testDisabled: e.target.checked })} /></Field>
      {c.controlType === "SoundPlayer" && (
        <SoundPlayerOptionsEditor optionsJson={c.optionsJson} onChange={json => update({ optionsJson: json })} soundFiles={soundFiles} hasSpeaker={hasSpeaker} />
      )}
      <OptionsField kind="control" typeName={c.controlType} value={c.optionsJson} onChange={optionsJson => update({ optionsJson })} example='e.g. {"blinkCycleMs":500}' />
      <div className="col-span-2 flex gap-2 justify-end">
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        <button className={btnPrimary} onClick={() => onSave(c)}>Save</button>
      </div>
    </div>
  );
}

function TelemetryEditor({
  initial, isNew, onSave, onCancel, telemetryTypes,
}: { initial?: TelemetryChannel; isNew: boolean; onSave: (t: TelemetryChannel) => Promise<void>; onCancel: () => void; telemetryTypes: string[] }) {
  const [t, setT] = useState<TelemetryChannel>(initial ?? {
    channelName: "", readIntervalTicks: msToTicks(1000), telemetryType: "", dataType: 0, unit: "", decimals: null,
    pinManager: "default", address: null, optionsJson: "",
  });
  const update = (patch: Partial<TelemetryChannel>) => setT(prev => ({ ...prev, ...patch }));
  // What the reader declares for this value. A new channel takes it over until
  // type, unit or decimals are edited by hand; an existing one only offers it.
  const { schemas } = useContext(OptionsInfo);
  const suggestion = suggestTelemetryValue(findSchema(schemas, "telemetry", t.telemetryType), t.channelName, t.optionsJson ?? "");
  const [manual, setManual] = useState(!isNew);
  const suggestionKey = suggestion ? `${suggestion.dataType}|${suggestion.unit}|${suggestion.decimals}` : "";
  useEffect(() => {
    if (manual || !suggestion) return;
    setT(prev => ({ ...prev, dataType: suggestion.dataType, unit: suggestion.unit, decimals: suggestion.decimals }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manual, suggestionKey]);
  const edit = (patch: Partial<TelemetryChannel>) => { setManual(true); update(patch); };
  const differs = suggestion !== undefined && (suggestion.dataType !== t.dataType || suggestion.unit !== (t.unit ?? "") || suggestion.decimals !== (t.decimals ?? null));
  const suggestionText = suggestion
    ? [DATA_TYPES[suggestion.dataType], suggestion.unit, suggestion.decimals !== null ? `${suggestion.decimals} decimals` : ""].filter(Boolean).join(", ")
    : "";
  return (
    <div id={isNew ? "new-telemetry-editor" : undefined} className="grid grid-cols-2 gap-2 p-2 border border-zinc-700 rounded bg-zinc-950">
      <Field label="Channel name"><input className={inputClass} value={t.channelName} onChange={e => update({ channelName: e.target.value })} disabled={!isNew} /></Field>
      <Field label="Telemetry type">
        <input className={inputClass + " font-mono"} value={t.telemetryType} onChange={e => update({ telemetryType: e.target.value })} list="telemetry-type-options" placeholder="e.g. SignalRC.Onboard.Telemetry.CpuTemperatureReader" />
      </Field>
      <Field label="Read interval (ms)" hint={`${t.readIntervalTicks} × ${TICK_MS} ms onboard ticks; rounded to whole ticks`}>
        <ReadIntervalInput ticks={t.readIntervalTicks} onChange={readIntervalTicks => update({ readIntervalTicks })} />
      </Field>
      <Field label="Data type" hint={suggestion ? (differs ? `Reader suggests: ${suggestionText}` : `As the reader suggests (${suggestionText})`) : undefined}>
        <div className="flex gap-2">
          <select className={inputClass} value={t.dataType} onChange={e => edit({ dataType: Number(e.target.value) })}>
            {DATA_TYPES.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          {differs && suggestion && (
            <button type="button" className={btnGhost + " whitespace-nowrap"} title={`Set ${suggestionText}`}
              onClick={() => update({ dataType: suggestion.dataType, unit: suggestion.unit, decimals: suggestion.decimals })}>Apply</button>
          )}
        </div>
      </Field>
      <Field label="Unit"><input className={inputClass} value={t.unit ?? ""} onChange={e => edit({ unit: e.target.value })} /></Field>
      <Field label="Decimals"><input className={inputClass} type="number" value={t.decimals ?? ""} onChange={e => edit({ decimals: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Pin manager"><input className={inputClass} value={t.pinManager ?? ""} onChange={e => update({ pinManager: e.target.value })} list="pin-manager-options" /></Field>
      <Field label="Address (int)"><input className={inputClass} type="number" value={t.address ?? ""} onChange={e => update({ address: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <OptionsField kind="telemetry" typeName={t.telemetryType} value={t.optionsJson} onChange={optionsJson => update({ optionsJson })} example='e.g. {"groupKey":"battery"}' className="col-span-2" />
      <div className="col-span-2 flex gap-2 justify-end">
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        <button className={btnPrimary} onClick={() => onSave(t)}>Save</button>
      </div>
    </div>
  );
}

function VideoEditor({
  initial, isNew, onSave, onCancel,
}: { initial?: VideoStream; isNew: boolean; onSave: (v: VideoStream) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<VideoStream>(initial ?? {
    streamId: "", name: "", type: "camera", location: "", enabled: true, width: 1280, height: 720,
    framerate: 30, bitrateKbps: 1500, cameraDevice: "", rpiCamId: null, priority: 0, optionsJson: "",
  });
  const update = (patch: Partial<VideoStream>) => setV(prev => ({ ...prev, ...patch }));
  return (
    <div className="grid grid-cols-2 gap-2 p-2 border border-zinc-700 rounded bg-zinc-950">
      <Field label="Stream ID"><input className={inputClass} value={v.streamId} onChange={e => update({ streamId: e.target.value })} disabled={!isNew} /></Field>
      <Field label="Name"><input className={inputClass} value={v.name ?? ""} onChange={e => update({ name: e.target.value })} /></Field>
      <Field label="Type" hint="v4l2 = USB webcam (Camera device), otherwise Raspberry Pi camera (RpiCamId)">
        <input className={inputClass} value={v.type ?? ""} onChange={e => update({ type: e.target.value })} list="video-type-options" />
      </Field>
      <Field label="Location"><input className={inputClass} value={v.location ?? ""} onChange={e => update({ location: e.target.value })} /></Field>
      <Field label="Camera device"><input className={inputClass} value={v.cameraDevice ?? ""} onChange={e => update({ cameraDevice: e.target.value })} placeholder="/dev/video0" /></Field>
      <Field label="RpiCamId"><input className={inputClass} type="number" value={v.rpiCamId ?? ""} onChange={e => update({ rpiCamId: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Priority"><input className={inputClass} type="number" value={v.priority ?? ""} onChange={e => update({ priority: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Enabled"><input type="checkbox" checked={v.enabled} onChange={e => update({ enabled: e.target.checked })} /></Field>
      <Field label="Width"><input className={inputClass} type="number" value={v.width ?? ""} onChange={e => update({ width: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Height"><input className={inputClass} type="number" value={v.height ?? ""} onChange={e => update({ height: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Framerate"><input className={inputClass} type="number" value={v.framerate ?? ""} onChange={e => update({ framerate: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <Field label="Bitrate (kbps)"><input className={inputClass} type="number" value={v.bitrateKbps ?? ""} onChange={e => update({ bitrateKbps: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
      <OptionsField kind="video" typeName={v.type} value={v.optionsJson} onChange={optionsJson => update({ optionsJson })} example='v4l2 webcam: {"inputFormat":"mjpeg","hwEncoder":true}' className="col-span-2" />
      <div className="col-span-2 flex gap-2 justify-end">
        <button className={btnGhost} onClick={onCancel}>Cancel</button>
        <button className={btnPrimary} onClick={() => onSave(v)}>Save</button>
      </div>
    </div>
  );
}

// Files for SoundPlayer channels. Stored on the server; the vehicle keeps a synced copy.
function SoundLibraryEditor({
  carId, files, onChanged, hasSpeaker,
}: { carId: number; files: SoundFile[]; onChanged: () => void; hasSpeaker: boolean }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.append("file", file);
        const r = await fetch(`/api/cars/${carId}/sounds`, { method: "POST", body: form });
        if (!r.ok) alert(`${file.name}: ${await r.text()}`);
      }
    } finally {
      setUploading(false);
      onChanged();
    }
  };
  const remove = async (name: string) => {
    if (!confirm(`Delete sound "${name}"? Channels using it stay silent.`)) return;
    const r = await fetch(`/api/cars/${carId}/sounds/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) { alert(await r.text()); return; }
    onChanged();
  };
  return (
    <div className="space-y-2 text-xs text-zinc-400">
      <p>Sound files for control channels of type <span className="font-mono text-zinc-200">SoundPlayer</span> (horn, sirens, music …). The vehicle downloads them automatically; up to 20 MB per file.</p>
      {!hasSpeaker && <p className="text-amber-400">No speaker configured yet (Audio tab) — sounds can be uploaded but won&apos;t play.</p>}
      <label className={btnPrimary + " inline-block cursor-pointer"}>
        {uploading ? "Uploading…" : "+ Upload sounds"}
        <input type="file" multiple accept={SOUND_EXTENSIONS.join(",")} className="hidden" disabled={uploading} onChange={e => { void upload(e.target.files); e.target.value = ""; }} />
      </label>
      <div className="space-y-1">
        {files.map(f => (
          <div key={f.name} className="flex items-center justify-between gap-2 border border-zinc-800 rounded p-2 bg-zinc-900">
            <div className="font-mono text-zinc-100 truncate">{f.name} <span className="text-zinc-500">{formatBytes(f.sizeBytes)}</span></div>
            <div className="flex items-center gap-2">
              <audio controls preload="none" className="h-6 w-48" src={`/api/cars/${carId}/sounds/${encodeURIComponent(f.name)}`} />
              <button className={btnDanger} onClick={() => remove(f.name)}>Delete</button>
            </div>
          </div>
        ))}
        {files.length === 0 && <div className="text-zinc-500">No sounds yet.</div>}
      </div>
    </div>
  );
}

const SETUP_TABS = ["control", "telemetry", "video", "audio", "hardware", "wiring", "diagnostics"] as const;
type SetupTab = typeof SETUP_TABS[number];

/** Configuration on the left, its live test on the right; stacked on narrow screens. */
function ConfigAndTest({ config, test, testTitle }: { config: React.ReactNode; test: React.ReactNode; testTitle: string }) {
  return (
    <div className="grid gap-x-4 lg:grid-cols-2 items-start">
      <div className="min-w-0">{config}</div>
      <div className="min-w-0 lg:sticky lg:top-2">
        <CollapsibleSection title={testTitle} defaultCollapsed={false} className="px-2 pb-2">{test}</CollapsibleSection>
      </div>
    </div>
  );
}

export default function SetupPage() {
  const { messages } = useI18n();
  const router = useRouter();
  const carId = router.query.carId as string;
  const carIdNum = carId ? parseInt(carId) : undefined;

  const [pinManagers, setPinManagers] = useState<PinManager[]>([]);
  const [controls, setControls] = useState<ControlChannel[]>([]);
  const [telemetries, setTelemetries] = useState<TelemetryChannel[]>([]);
  const [videos, setVideos] = useState<VideoStream[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [availableControlTypes, setAvailableControlTypes] = useState<string[]>([]);
  const [availableTelemetryTypes, setAvailableTelemetryTypes] = useState<string[]>([]);
  const [optionSchemas, setOptionSchemas] = useState(parseOptionSchemas(undefined));
  const [activeTab, setActiveTab] = useState<SetupTab>("control");
  const [savedAudioSettings, setSavedAudioSettings] = useState<CarAudioSettings>(DEFAULT_CAR_AUDIO_SETTINGS);
  const [soundFiles, setSoundFiles] = useState<SoundFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<Health | null>(null);
  const [editingPinManager, setEditingPinManager] = useState<{ key: string; pinManager: PinManager; isNew: boolean } | null>(null);
  const [editingControl, setEditingControl] = useState<{ key: string; channel: ControlChannel; isNew: boolean } | null>(null);
  const [editingTelemetry, setEditingTelemetry] = useState<{ key: string; channel: TelemetryChannel; isNew: boolean } | null>(null);
  const [editingVideo, setEditingVideo] = useState<{ key: string; stream: VideoStream; isNew: boolean } | null>(null);

  const load = useCallback(async (showLoading: boolean) => {
    if (!carIdNum) return;
    if (showLoading) setLoading(true);
    try {
      const [r, t] = await Promise.all([
        fetch(`/api/cars/${carIdNum}/channels`),
        fetch(`/api/templates`),
      ]);
      if (!r.ok) throw new Error(await r.text());
      const map = await r.json();
      const templatesList = t.ok ? await t.json() : [];

      setPinManagers(Object.entries(map.pinManagers ?? {}).map(([k, v]: [string, any]) => ({
        name: k,
        type: v.type ?? "",
        optionsJson: formatOptionsJson(v.options),
        modifiedAt: v.modifiedAt ?? null,
      })));
      setControls(Object.entries(map.controlChannels ?? {}).map(([k, v]: [string, any]) => ({
        channelName: k,
        displayName: v.displayName ?? null,
        isEnabled: v.isEnabled ?? true,
        requiresAxis: v.requiresAxis ?? false,
        maxResendInterval: v.maxResendInterval ?? null,
        controlType: v.controlType ?? "",
        pinManager: v.pinManager ?? "default",
        address: v.address ?? null,
        testDisabled: v.testDisabled ?? false,
        optionsJson: formatOptionsJson(v.options),
        modifiedAt: v.modifiedAt ?? null,
      })));
      setTelemetries(Object.entries(map.telemetryChannels ?? {}).map(([k, v]: [string, any]) => ({
        channelName: k,
        readIntervalTicks: v.readIntervalTicks ?? 1,
        telemetryType: v.telemetryType ?? "",
        dataType: v.dataType ?? 0,
        unit: v.unit ?? null,
        decimals: v.decimals ?? null,
        pinManager: v.pinManager ?? "default",
        address: v.address ?? null,
        optionsJson: formatOptionsJson(v.options),
        modifiedAt: v.modifiedAt ?? null,
      })));
      setVideos(Object.entries(map.videoStreams ?? {}).map(([k, v]: [string, any]) => ({
        streamId: k,
        name: v.name ?? null,
        type: v.type ?? null,
        location: v.location ?? null,
        enabled: v.enabled ?? false,
        width: v.width ?? null,
        height: v.height ?? null,
        framerate: v.framerate ?? null,
        bitrateKbps: typeof v.bitrate === "number" ? Math.round(v.bitrate / 1000) : null,
        cameraDevice: v.cameraDevice ?? null,
        rpiCamId: v.rpiCamId ?? null,
        priority: v.priority ?? null,
        optionsJson: formatOptionsJson(v.options),
        modifiedAt: v.modifiedAt ?? null,
      })));
      setTemplates(Array.isArray(templatesList) ? templatesList : []);
    } catch (e) {
      console.error("Failed to load channels:", e);
    } finally {
      setLoading(false);
    }
  }, [carIdNum]);
  const reload = useCallback(() => load(true), [load]);
  // "default" is the GPIO manager every vehicle has without an entry.
  const pinManagerNames = useMemo(() => ["default", ...pinManagers.map(p => p.name).filter(n => n !== "default")], [pinManagers]);
  const optionsInfo = useMemo(() => ({ schemas: optionSchemas.schemas, pinManagers: pinManagerNames }), [optionSchemas, pinManagerNames]);
  const channelRefs = useMemo<ChannelRef[]>(() => [
    ...controls.map(c => ({ kind: "control" as const, name: c.channelName, type: c.controlType, pinManager: c.pinManager, address: c.address })),
    ...telemetries.map(t => ({ kind: "telemetry" as const, name: t.channelName, type: t.telemetryType, pinManager: t.pinManager, address: t.address })),
  ], [controls, telemetries]);
  // A pin in the board editor prefills a new channel; the editor opens below and is scrolled to.
  const createChannelFromBoard = useCallback((r: NewChannelRequest) => {
    setActiveTab(r.kind === "control" ? "control" : "telemetry");
    if (r.kind === "control") {
      setEditingControl({ key: "__new__", isNew: true, channel: {
        channelName: r.channelName, displayName: "", isEnabled: true, requiresAxis: false, maxResendInterval: null,
        controlType: r.type, pinManager: r.pinManager, address: r.address, testDisabled: false, optionsJson: formatOptionsJson(r.options),
      } });
    } else {
      setEditingTelemetry({ key: "__new__", isNew: true, channel: {
        channelName: r.channelName, readIntervalTicks: r.readIntervalTicks ?? 1, telemetryType: r.type, dataType: r.dataType ?? 0,
        unit: r.unit ?? "", decimals: r.decimals ?? null, pinManager: r.pinManager, address: r.address, optionsJson: formatOptionsJson(r.options),
      } });
    }
    setTimeout(() => document.getElementById(r.kind === "control" ? "new-control-editor" : "new-telemetry-editor")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }, []);
  const boardContext = useMemo<BoardContext>(() => ({
    carId: carIdNum ?? 0, channels: channelRefs, pinManagers, boardModel: optionSchemas.boardModel, onCreateChannel: createChannelFromBoard,
  }), [carIdNum, channelRefs, pinManagers, optionSchemas.boardModel, createChannelFromBoard]);
  const hasDefaultEntry = pinManagers.some(p => p.name === "default");

  // Keeps embedded helpers (LiDAR source) mounted with their status message.
  const reloadQuietly = useCallback(() => { void load(false); }, [load]);

  useEffect(() => { reload(); }, [reload]);

  // The onboard applies a change within a tick and reports the outcome; poll while the page is open.
  useEffect(() => {
    if (!carIdNum) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/cars/${carIdNum}/channels/health`);
        if (!r.ok || cancelled) return;
        const h = await r.json();
        setHealth({ connected: !!h.connected, entries: Array.isArray(h.entries) ? h.entries : null });
      } catch { /* keep the last status */ }
    };
    void poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [carIdNum]);
  const healthOf = useCallback((kind: HealthEntry["kind"], name: string) =>
    health?.entries?.find(e => e.kind === kind && e.name === name), [health]);

  useEffect(() => {
    if (!carIdNum) return;
    (async () => {
      const [c, t, o] = await Promise.all([
        fetch(`/api/cars/${carIdNum}/channels/available-control-types`).then(r => r.ok ? r.json() : []),
        fetch(`/api/cars/${carIdNum}/channels/available-telemetry-types`).then(r => r.ok ? r.json() : []),
        fetch(`/api/cars/${carIdNum}/channels/option-schemas`).then(r => r.ok ? r.json() : null),
      ]);
      if (Array.isArray(c)) setAvailableControlTypes(c);
      if (Array.isArray(t)) setAvailableTelemetryTypes(t);
      setOptionSchemas(parseOptionSchemas(o));
    })();
  }, [carIdNum]);

  useEffect(() => {
    if (!carIdNum) return;
    fetch(`/api/cars/${carIdNum}/channels/audio-settings`)
      .then(r => r.ok ? r.json() : null)
      .then(settings => setSavedAudioSettings({ ...DEFAULT_CAR_AUDIO_SETTINGS, ...(settings ?? {}) }))
      .catch(() => { /* stays at the defaults: no devices */ });
  }, [carIdNum]);

  // ?tab= opens a tab directly and survives a reload.
  const requestedTab = router.query.tab;
  useEffect(() => {
    if (typeof requestedTab === "string" && (SETUP_TABS as readonly string[]).includes(requestedTab))
      setActiveTab(requestedTab as SetupTab);
  }, [requestedTab]);
  const selectTab = useCallback((tab: SetupTab) => {
    setActiveTab(tab);
    void router.replace({ pathname: router.pathname, query: { ...router.query, tab } }, undefined, { shallow: true });
  }, [router]);

  const reloadSounds = useCallback(async () => {
    if (!carIdNum) return;
    const r = await fetch(`/api/cars/${carIdNum}/sounds`);
    setSoundFiles(r.ok ? await r.json() : []);
  }, [carIdNum]);

  useEffect(() => { void reloadSounds(); }, [reloadSounds]);

  const savePinManager = async (origKey: string, p: PinManager, isNew: boolean) => {
    if (!carIdNum) return;
    let options: any = undefined;
    if (p.optionsJson && p.optionsJson.trim()) {
      try { options = JSON.parse(p.optionsJson); }
      catch { alert("Options JSON invalid"); return; }
    }
    const body = { name: p.name, type: p.type, options };
    const r = await fetch(`/api/cars/${carIdNum}/channels/pinmanager/${encodeURIComponent(isNew ? p.name : origKey)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await r.text()); return; }
    setEditingPinManager(null);
    reload();
  };

  const deletePinManager = async (key: string) => {
    if (!carIdNum || !confirm(`Delete pin manager "${key}"?`)) return;
    const r = await fetch(`/api/cars/${carIdNum}/channels/pinmanager/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!r.ok) { alert(await r.text()); return; }
    reload();
  };

  const saveControl = async (origKey: string, ch: ControlChannel, isNew: boolean) => {
    if (!carIdNum) return;
    let options: any = undefined;
    if (ch.optionsJson && ch.optionsJson.trim()) {
      try { options = JSON.parse(ch.optionsJson); }
      catch { alert("Options JSON invalid"); return; }
    }
    const body: any = {
      channelName: ch.channelName,
      displayName: ch.displayName,
      isEnabled: ch.isEnabled,
      requiresAxis: ch.requiresAxis,
      maxResendInterval: ch.maxResendInterval,
      controlType: ch.controlType,
      pinManager: ch.pinManager,
      address: ch.address,
      testDisabled: ch.testDisabled,
      options,
    };
    const r = await fetch(`/api/cars/${carIdNum}/channels/control/${encodeURIComponent(isNew ? ch.channelName : origKey)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await r.text()); return; }
    setEditingControl(null);
    reload();
  };

  // Deleting a channel the HUD uses breaks its bindings: warn first (AP02 dependencies).
  const confirmChannelDelete = async (question: string, channel: string) => {
    if (!carIdNum) return false;
    const m = messages.overlay.channels;
    const warning = dependencyWarning(await loadChannelDependencies(carIdNum, channel), channel, m);
    return confirm(confirmationText(question, warning, m));
  };

  const deleteControl = async (key: string) => {
    if (!carIdNum || !(await confirmChannelDelete(`Delete control channel "${key}"?`, key))) return;
    const r = await fetch(`/api/cars/${carIdNum}/channels/control/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!r.ok) { alert(await r.text()); return; }
    reload();
  };

  const saveTelemetry = async (origKey: string, t: TelemetryChannel, isNew: boolean) => {
    if (!carIdNum) return;
    let options: any = undefined;
    if (t.optionsJson && t.optionsJson.trim()) {
      try { options = JSON.parse(t.optionsJson); }
      catch { alert("Options JSON invalid"); return; }
    }
    const body: any = {
      channelName: t.channelName,
      readIntervalTicks: t.readIntervalTicks,
      telemetryType: t.telemetryType,
      dataType: t.dataType,
      unit: t.unit,
      decimals: t.decimals,
      pinManager: t.pinManager,
      address: t.address,
      options,
    };
    const r = await fetch(`/api/cars/${carIdNum}/channels/telemetry/${encodeURIComponent(isNew ? t.channelName : origKey)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await r.text()); return; }
    setEditingTelemetry(null);
    reload();
  };

  const deleteTelemetry = async (key: string) => {
    if (!carIdNum || !(await confirmChannelDelete(`Delete telemetry channel "${key}"?`, key))) return;
    const r = await fetch(`/api/cars/${carIdNum}/channels/telemetry/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!r.ok) { alert(await r.text()); return; }
    reload();
  };

  const saveVideo = async (origKey: string, v: VideoStream, isNew: boolean) => {
    if (!carIdNum) return;
    let options: any = undefined;
    if (v.optionsJson && v.optionsJson.trim()) {
      try { options = JSON.parse(v.optionsJson); }
      catch { alert("Options JSON invalid"); return; }
    }
    const body: any = {
      streamId: v.streamId, name: v.name, type: v.type, location: v.location, enabled: v.enabled,
      // The server stores bit/s; only the editor shows kbps.
      width: v.width, height: v.height, framerate: v.framerate, bitrateKbps: v.bitrateKbps == null ? null : Math.round(v.bitrateKbps * 1000),
      cameraDevice: v.cameraDevice, rpiCamId: v.rpiCamId, priority: v.priority, options,
    };
    const r = await fetch(`/api/cars/${carIdNum}/channels/video/${encodeURIComponent(isNew ? v.streamId : origKey)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) { alert(await r.text()); return; }
    setEditingVideo(null);
    reload();
  };

  const deleteVideo = async (key: string) => {
    if (!carIdNum || !confirm(`Delete video stream "${key}"?`)) return;
    const r = await fetch(`/api/cars/${carIdNum}/channels/video/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!r.ok) { alert(await r.text()); return; }
    reload();
  };

  const applyTemplate = async () => {
    if (!carIdNum || !selectedTemplateId) return;
    setApplyingTemplate(true);
    try {
      const r = await fetch(`/api/templates/cars/${carIdNum}/apply/${selectedTemplateId}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      await reload();
    } catch (e: any) {
      alert("Failed to apply template: " + e.message);
    } finally {
      setApplyingTemplate(false);
    }
  };

  if (!carIdNum) return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;
  if (loading) return <div className="p-8 text-zinc-300">{messages.common.loading}</div>;

  const sp = messages.setupPage;
  const countOf = (tab: SetupTab): number | null => {
    switch (tab) {
      case "control": return controls.length;
      case "telemetry": return telemetries.length;
      case "video": return videos.length;
      case "audio": return (savedAudioSettings.inputDevice ? 1 : 0) + (savedAudioSettings.outputDevice ? 1 : 0);
      case "hardware": return pinManagers.length;
      default: return null;
    }
  };
  const HEALTH_KIND_OF_TAB: Partial<Record<SetupTab, HealthEntry["kind"]>> = { control: "control", telemetry: "telemetry", video: "video", hardware: "pinManager" };
  const problemsOf = (tab: SetupTab) => health?.entries?.filter(e => e.kind === HEALTH_KIND_OF_TAB[tab]).length ?? 0;

  return (
    <ConfigGuard carId={carIdNum}>
      <OptionsInfo.Provider value={optionsInfo}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 print:bg-white print:text-black">
        <ConfigHeader carId={carIdNum} active="setup" className="mb-4 print:hidden"
          actions={<>
            <button
              className={btnGhost}
              title={sp.exportConfigHint}
              onClick={() => downloadVehicleConfig(carIdNum).catch(e => alert(`${sp.exportConfigFailed}: ${String(e?.message ?? e)}`))}
            >
              {sp.exportConfig}
            </button>
            <ConfigImportButton carId={carIdNum} onImported={reload} />
            <button className={btnGhost} onClick={reload}>{sp.reload}</button>
          </>} />

        <div className="print:hidden"><HealthSummary health={health} /></div>

        <div role="tablist" aria-label={sp.tabsLabel} className="flex gap-1 mt-2 mb-2 overflow-x-auto overflow-y-hidden border-b border-zinc-800 print:hidden">
          {SETUP_TABS.map(tab => {
            const problems = problemsOf(tab);
            return (
              <button
                key={tab}
                role="tab"
                id={`setup-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls="setup-tab-panel"
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs border-b-2 ${activeTab === tab ? "border-green-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
                onClick={() => selectTab(tab)}
              >
                {sp.tabs[tab]}
                {countOf(tab) != null && <span className="text-zinc-500">{countOf(tab)}</span>}
                {problems > 0 && <span className="w-1.5 h-1.5 rounded-full bg-red-500" title={sp.tabProblems(problems)} />}
              </button>
            );
          })}
        </div>

        <div id="setup-tab-panel" role="tabpanel" aria-labelledby={`setup-tab-${activeTab}`}>
        {activeTab === "control" && (
          <ConfigAndTest
            testTitle={sp.testControl}
            test={<ControlTestPanel carId={carIdNum} channels={controls} />}
            config={<>
        <CollapsibleSection title={`Control channels (${controls.length})`} defaultCollapsed={false}>
          <button className={btnPrimary + " mb-2"} onClick={() => setEditingControl({ key: "__new__", channel: {} as ControlChannel, isNew: true })}>+ Add control channel</button>
          <div className="space-y-1">
            {controls.map(c => (
              <div key={c.channelName} className="border border-zinc-800 rounded p-2 bg-zinc-900">
                {editingControl?.key === c.channelName && !editingControl.isNew ? (
                  <ControlEditor initial={c} isNew={false} onSave={(nc) => saveControl(c.channelName, nc, false)} onCancel={() => setEditingControl(null)} controlTypes={availableControlTypes} soundFiles={soundFiles} hasSpeaker={!!savedAudioSettings.outputDevice} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">
                      <span className="text-zinc-100">{c.channelName}</span>
                      <span className="text-zinc-500 ml-2">{c.controlType || "?"} @ {c.pinManager}#{c.address ?? "-"}</span>
                      {c.displayName && <span className="text-zinc-400 ml-2">({c.displayName})</span>}
                    </div>
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={() => setEditingControl({ key: c.channelName, channel: c, isNew: false })}>Edit</button>
                      <button className={btnDanger} onClick={() => deleteControl(c.channelName)}>Delete</button>
                    </div>
                  </div>
                )}
                <HealthLine entry={healthOf("control", c.channelName)} carId={carIdNum} />
              </div>
            ))}
            {editingControl?.isNew && (
              <ControlEditor key={editingControl.channel.channelName ?? "new"} initial={editingControl.channel.channelName ? editingControl.channel : undefined} isNew={true} onSave={(nc) => saveControl("__new__", nc, true)} onCancel={() => setEditingControl(null)} controlTypes={availableControlTypes} soundFiles={soundFiles} hasSpeaker={!!savedAudioSettings.outputDevice} />
            )}
          </div>
        </CollapsibleSection>
            </>}
          />
        )}

        {activeTab === "telemetry" && (
          <ConfigAndTest
            testTitle={sp.testTelemetry}
            test={<TelemetryTestPanel carId={carIdNum} refreshKey={telemetries.map(t => t.channelName).join("|")} />}
            config={<>
        <CollapsibleSection title={`Telemetry channels (${telemetries.length})`} defaultCollapsed={false}>
          <button className={btnPrimary + " mb-2"} onClick={() => setEditingTelemetry({ key: "__new__", channel: {} as TelemetryChannel, isNew: true })}>+ Add telemetry channel</button>
          <div className="space-y-1">
            {telemetries.map(t => (
              <div key={t.channelName} className="border border-zinc-800 rounded p-2 bg-zinc-900">
                {editingTelemetry?.key === t.channelName && !editingTelemetry.isNew ? (
                  <TelemetryEditor initial={t} isNew={false} onSave={(nt) => saveTelemetry(t.channelName, nt, false)} onCancel={() => setEditingTelemetry(null)} telemetryTypes={availableTelemetryTypes} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">
                      <span className="text-zinc-100">{t.channelName}</span>
                      <span className="text-zinc-500 ml-2">{t.telemetryType || "?"} / {DATA_TYPES[t.dataType] ?? "?"} {t.unit ? `(${t.unit})` : ""} @ {t.pinManager}#{t.address ?? "-"}</span>
                    </div>
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={() => setEditingTelemetry({ key: t.channelName, channel: t, isNew: false })}>Edit</button>
                      <button className={btnDanger} onClick={() => deleteTelemetry(t.channelName)}>Delete</button>
                    </div>
                  </div>
                )}
                <HealthLine entry={healthOf("telemetry", t.channelName)} carId={carIdNum} />
              </div>
            ))}
            {editingTelemetry?.isNew && (
              <TelemetryEditor key={editingTelemetry.channel.channelName ?? "new"} initial={editingTelemetry.channel.channelName ? editingTelemetry.channel : undefined} isNew={true} onSave={(nt) => saveTelemetry("__new__", nt, true)} onCancel={() => setEditingTelemetry(null)} telemetryTypes={availableTelemetryTypes} />
            )}
          </div>
        </CollapsibleSection>
            </>}
          />
        )}

        {activeTab === "video" && (
          <ConfigAndTest
            testTitle={sp.testVideo}
            test={<div className="h-[400px]"><CarVideoPanel carId={carIdNum} /></div>}
            config={<>
        <CollapsibleSection title={`Video streams (${videos.length})`} defaultCollapsed={false}>
          <button className={btnPrimary + " mb-2"} onClick={() => setEditingVideo({ key: "__new__", stream: {} as VideoStream, isNew: true })}>+ Add video stream</button>
          <div className="space-y-1">
            {videos.map(v => (
              <div key={v.streamId} className="border border-zinc-800 rounded p-2 bg-zinc-900">
                {editingVideo?.key === v.streamId && !editingVideo.isNew ? (
                  <VideoEditor initial={v} isNew={false} onSave={(nv) => saveVideo(v.streamId, nv, false)} onCancel={() => setEditingVideo(null)} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">
                      <span className="text-zinc-100">{v.streamId}</span>
                      <span className="text-zinc-500 ml-2">{v.name || "?"} {v.type ? `(${v.type})` : ""} {v.location ? `@ ${v.location}` : ""} {v.priority != null ? `· prio ${v.priority}` : ""}</span>
                    </div>
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={() => setEditingVideo({ key: v.streamId, stream: v, isNew: false })}>Edit</button>
                      <button className={btnDanger} onClick={() => deleteVideo(v.streamId)}>Delete</button>
                    </div>
                  </div>
                )}
                <HealthLine entry={healthOf("video", v.streamId)} carId={carIdNum} />
              </div>
            ))}
            {editingVideo?.isNew && (
              <VideoEditor isNew={true} onSave={(nv) => saveVideo("__new__", nv, true)} onCancel={() => setEditingVideo(null)} />
            )}
          </div>
        </CollapsibleSection>
            </>}
          />
        )}

        {activeTab === "audio" && (
          <ConfigAndTest
            testTitle={sp.testAudio}
            test={
              // Remounted on a change: both read the devices once.
              <div key={`${savedAudioSettings.inputDevice}|${savedAudioSettings.outputDevice}`} className="space-y-2">
                <VehicleAudio carId={carIdNum} />
                <AudioChat carId={carIdNum} />
              </div>
            }
            config={<>
              <CollapsibleSection title={sp.audioDevices} defaultCollapsed={false} className="px-2 pb-2">
                <AudioDeviceManager carId={carIdNum} settings={savedAudioSettings} onSaved={setSavedAudioSettings} />
              </CollapsibleSection>
        <CollapsibleSection title={`Sounds (${soundFiles.length})`} defaultCollapsed={false}>
          <SoundLibraryEditor carId={carIdNum} files={soundFiles} onChanged={() => void reloadSounds()} hasSpeaker={!!savedAudioSettings.outputDevice} />
        </CollapsibleSection>
            </>}
          />
        )}

        {activeTab === "hardware" && (
          <>
        <CollapsibleSection title="Templates" defaultCollapsed={false}>
          <div className="flex items-end gap-2 mb-2">
            <Field label="Template">
              <select
                className={inputClass + " min-w-[200px]"}
                value={selectedTemplateId}
                onChange={e => setSelectedTemplateId(e.target.value === "" ? "" : Number(e.target.value))}
              >
                <option value="">-- select template --</option>
                {templates.map(tpl => (
                  <option key={tpl.id} value={tpl.id}>{tpl.name} {tpl.version ? `(v${tpl.version})` : ""}</option>
                ))}
              </select>
            </Field>
            <button
              className={btnPrimary}
              onClick={applyTemplate}
              disabled={!selectedTemplateId || applyingTemplate}
            >
              {applyingTemplate ? "Applying..." : "Apply template"}
            </button>
          </div>
          {selectedTemplateId && (
            <div className="text-xs text-zinc-400">
              {(() => {
                const tpl = templates.find(t => t.id === selectedTemplateId);
                return tpl?.description || "No description";
              })()}
            </div>
          )}
        </CollapsibleSection>
        <CollapsibleSection title={`Pin managers (${pinManagers.length})`} defaultCollapsed={false}>
          <button className={btnPrimary + " mb-2"} onClick={() => setEditingPinManager({ key: "__new__", pinManager: {} as PinManager, isNew: true })}>+ Add pin manager</button>
          <div className="space-y-1">
            {pinManagers.map(p => (
              <div key={p.name} className="border border-zinc-800 rounded p-2 bg-zinc-900">
                {editingPinManager?.key === p.name && !editingPinManager.isNew ? (
                  <PinManagerEditor initial={p} isNew={false} onSave={(np) => savePinManager(p.name, np, false)} onCancel={() => setEditingPinManager(null)} board={boardContext} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">
                      <span className="text-zinc-100">{p.name}</span>
                      <span className="text-zinc-500 ml-2">{p.type || "?"}</span>
                    </div>
                    <div className="flex gap-1">
                      <button className={btnGhost} onClick={() => setEditingPinManager({ key: p.name, pinManager: p, isNew: false })}>Edit</button>
                      <button className={btnDanger} onClick={() => deletePinManager(p.name)}>Delete</button>
                    </div>
                  </div>
                )}
                <HealthLine entry={healthOf("pinManager", p.name)} carId={carIdNum} />
              </div>
            ))}
            {!hasDefaultEntry && (
              <div className="border border-zinc-800 border-dashed rounded p-2 bg-zinc-900/50">
                {editingPinManager?.key === "default" ? (
                  <PinManagerEditor initial={{ name: "default", type: "RaspberryPiGpioManager", optionsJson: "" }} isNew={true}
                    onSave={(np) => savePinManager("default", np, true)} onCancel={() => setEditingPinManager(null)} board={boardContext} />
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs">
                      <span className="text-zinc-100">default</span>
                      <span className="text-zinc-500 ml-2">RaspberryPiGpioManager · built in, no pin configuration yet</span>
                    </div>
                    <button className={btnGhost} onClick={() => setEditingPinManager({ key: "default", pinManager: { name: "default", type: "RaspberryPiGpioManager", optionsJson: "" }, isNew: true })}>Configure pins</button>
                  </div>
                )}
                <HealthLine entry={healthOf("pinManager", "default")} carId={carIdNum} />
              </div>
            )}
            {editingPinManager?.isNew && editingPinManager.key === "__new__" && (
              <PinManagerEditor isNew={true} onSave={(np) => savePinManager("__new__", np, true)} onCancel={() => setEditingPinManager(null)} board={boardContext} />
            )}
          </div>
        </CollapsibleSection>
        <CollapsibleSection title={messages.overlay.lidarSource.title} defaultCollapsed={false}>
          <LidarSourceSetup carId={carIdNum} onChanged={reloadQuietly} />
        </CollapsibleSection>
          </>
        )}

        {activeTab === "wiring" && <WiringPanel carId={carIdNum} />}

        {activeTab === "diagnostics" && <OnboardDiagnostics carId={carIdNum} defaultCollapsed={false} />}
        </div>

        <datalist id="video-type-options">
          <option value="camera">Raspberry Pi camera</option>
          <option value="v4l2">USB webcam (V4L2)</option>
        </datalist>
        <datalist id="control-type-options">
          {availableControlTypes.map(t => <option key={t} value={t} />)}
        </datalist>
        <datalist id="telemetry-type-options">
          {availableTelemetryTypes.map(t => <option key={t} value={t} />)}
        </datalist>
        <datalist id="pin-manager-type-options">
          {optionSchemas.pinManagerTypes.map(t => <option key={t} value={t} />)}
        </datalist>
        <datalist id="pin-manager-options">
          {pinManagerNames.map(n => <option key={n} value={n} />)}
        </datalist>
      </div>
      </OptionsInfo.Provider>
    </ConfigGuard>
  );
}
