"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/i18n/provider";

type TemplateNode = {
  id: string;
  type: string;
  positionX: number;
  positionY: number;
  binding?: { deviceName: string; channelName: string; isAxis: boolean };
  channelName?: string;
  functionName?: string;
  params?: Record<string, string | null>;
};

type TemplateEdge = {
  fromNode: string;
  fromPort?: string | null;
  toNode: string;
  toPort?: string | null;
};

type TemplateSubscription = {
  channelName: string;
  order: number;
};

type Template = {
  schemaVersion: number;
  name?: string;
  description?: string;
  exportedAt?: string;
  channels: {
    control: any[];
    telemetry: any[];
    video: any[];
  };
  flow: { nodes: TemplateNode[]; edges: TemplateEdge[] };
  telemetrySubscriptions: TemplateSubscription[];
};

type GamepadChannel = {
  id: number;
  channelId: number;
  name?: string;
  isAxis: boolean;
  calibrationMin?: number;
  calibrationMax?: number;
  accuracy?: number;
};

type Gamepad = {
  id: number;
  name: string;
  axes: GamepadChannel[];
  buttons: GamepadChannel[];
};

type ImportResult = {
  ok: boolean;
  warnings: string[];
  nodesCreated: number;
  edgesCreated: number;
  telemetrySubscribed: number;
};

function channelLabel(c: GamepadChannel): string {
  return c.name ?? (c.isAxis ? `Axis ${c.channelId + 1}` : `Button ${c.channelId + 1}`);
}

function makeBindingKey(b: { deviceName: string; channelName: string; isAxis: boolean }): string {
  return `${b.deviceName}|${b.channelName}|${b.isAxis}`;
}

type BindingStatus = "auto" | "manual" | "unselected" | "device-missing" | "channel-missing";

function computeStatus(
  sourceBinding: TemplateNode["binding"],
  selectedKey: string | undefined,
  hasMatchingDevice: boolean,
  hasMatchingChannel: boolean,
): BindingStatus {
  if (!selectedKey) return "unselected";
  if (sourceBinding) {
    const exact = makeBindingKey(sourceBinding);
    if (selectedKey === exact) return "auto";
  }
  if (!hasMatchingDevice) return "device-missing";
  if (!hasMatchingChannel) return "channel-missing";
  return "manual";
}

export default function SetupTemplatePanel({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const t = messages.setupTemplate;

  const [gamepads, setGamepads] = useState<Gamepad[]>([]);
  const [busy, setBusy] = useState(false);

  // import dialog state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [template, setTemplate] = useState<Template | null>(null);
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/userconfig/gamepads")
      .then(r => r.ok ? r.json() : [])
      .then((d: Gamepad[]) => setGamepads(d ?? []))
      .catch(() => setGamepads([]));
  }, []);

  const allChannels = useMemo(() => {
    const list: { key: string; deviceName: string; channelName: string; isAxis: boolean }[] = [];
    for (const g of gamepads) {
      for (const a of g.axes) {
        list.push({ key: `${g.name}|${channelLabel(a)}|true`, deviceName: g.name, channelName: channelLabel(a), isAxis: true });
      }
      for (const b of g.buttons) {
        list.push({ key: `${g.name}|${channelLabel(b)}|false`, deviceName: g.name, channelName: channelLabel(b), isAxis: false });
      }
    }
    return list;
  }, [gamepads]);

  async function handleExport() {
    setBusy(true);
    try {
      const res = await fetch(`/api/setuptemplate/export/${carId}`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as Template;
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(json.name ?? `car-${carId}`).replace(/[^a-z0-9-_]/gi, "_")}-template.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  function handleImportClick() {
    setError(null);
    setResult(null);
    setShowDialog(true);
    setTimeout(() => fileInputRef.current?.click(), 0);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Template;
      setTemplate(json);
      const auto: Record<string, string> = {};
      const knownKeys = new Set(allChannels.map(c => c.key));
      for (const n of json.flow.nodes) {
        if (n.type === "input" && n.binding) {
          const k = makeBindingKey(n.binding);
          if (knownKeys.has(k)) auto[n.id] = k;
        }
      }
      setBindings(auto);
    } catch {
      setError(t.invalidJson);
      setTemplate(null);
    }
  }

  async function handleApply() {
    if (!template) return;
    setBusy(true);
    setError(null);
    try {
      const controllerBindings: Record<string, { deviceName: string; channelName: string; isAxis: boolean }> = {};
      for (const [nodeId, key] of Object.entries(bindings)) {
        const ch = allChannels.find(c => c.key === key);
        if (ch) controllerBindings[nodeId] = { deviceName: ch.deviceName, channelName: ch.channelName, isAxis: ch.isAxis };
      }
      const res = await fetch(`/api/setuptemplate/import/${carId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template, controllerBindings }),
      });
      if (!res.ok) throw new Error(await res.text());
      const r = (await res.json()) as ImportResult;
      setResult(r);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const inputNodes = template?.flow.nodes.filter(n => n.type === "input") ?? [];

  return (
    <div className="border border-white/8 bg-slate-900/45 p-3 shadow-[0_14px_32px_rgba(0,0,0,0.18)] text-xs">
      <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">{t.title}</div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={handleExport}
          disabled={busy}
          className="px-2 py-1 bg-sky-600 hover:bg-sky-700 text-white rounded disabled:opacity-50"
        >
          {t.export}
        </button>
        <button
          onClick={handleImportClick}
          disabled={busy}
          className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50"
        >
          {t.import}
        </button>
      </div>

      {showDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-lg shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-5 text-slate-100">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{t.title}</div>
              <button onClick={() => setShowDialog(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={handleFile}
            />

            {!template && !error && (
              <p className="mt-4 text-xs text-slate-400">{t.noFileSelected}</p>
            )}
            {error && <p className="mt-4 text-xs text-red-400">{error}</p>}

            {template && (
              <div className="mt-4 space-y-4">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">{template.name ?? `Car ${carId}`}</div>
                  <div className="text-xs text-slate-300">{t.summary(template.flow.nodes.length, template.flow.edges.length, template.telemetrySubscriptions.length)}</div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{t.bindingsTitle}</div>
                  <p className="text-[11px] text-slate-400 mb-2">{t.bindingsHint}</p>

                  {(() => {
                    const rows = inputNodes.map(n => {
                      const sb = n.binding;
                      const expectedKey = sb ? makeBindingKey(sb) : undefined;
                      const selectedKey = bindings[n.id];
                      const targetDevice = sb ? gamepads.find(g => g.name === sb.deviceName) : undefined;
                      const hasMatchingDevice = !!targetDevice;
                      const availableChannels: GamepadChannel[] = targetDevice
                        ? (sb!.isAxis ? targetDevice.axes : targetDevice.buttons)
                        : [];
                      const hasMatchingChannel = sb
                        ? availableChannels.some(c => channelLabel(c) === sb.channelName)
                        : false;
                      const status = computeStatus(sb, selectedKey, hasMatchingDevice, hasMatchingChannel);
                      return { node: n, sb, expectedKey, selectedKey, targetDevice, hasMatchingDevice, hasMatchingChannel, availableChannels, status };
                    });

                    const assigned = rows.filter(r => r.selectedKey).length;
                    const auto = rows.filter(r => r.status === "auto").length;
                    const manual = rows.filter(r => r.status === "manual").length;
                    const deviceMissing = rows.filter(r => r.status === "device-missing").length;
                    const channelMissing = rows.filter(r => r.status === "channel-missing").length;
                    const unselected = rows.filter(r => r.status === "unselected").length;

                    const deviceWarnings = new Map<string, { total: number; matched: number; missing: Set<string> }>();
                    for (const r of rows) {
                      if (!r.sb) continue;
                      const entry = deviceWarnings.get(r.sb.deviceName) ?? { total: 0, matched: 0, missing: new Set<string>() };
                      entry.total++;
                      if (r.status === "auto") entry.matched++;
                      else entry.missing.add(r.sb.channelName);
                      deviceWarnings.set(r.sb.deviceName, entry);
                    }

                    return (
                      <>
                        <div className="text-[11px] text-slate-300 mb-2">
                          {t.assignedSummary(assigned, rows.length)}
                          {rows.length > 0 && (
                            <span className="text-slate-500">
                              {" · "}{t.statusAuto}: {auto} · {t.statusManual}: {manual} · {t.statusUnselected}: {unselected}
                            </span>
                          )}
                        </div>

                        {(deviceMissing > 0 || channelMissing > 0) && (
                          <div className="border border-amber-700/60 bg-amber-900/15 p-2 rounded mb-3 text-[11px] space-y-0.5">
                            {Array.from(deviceWarnings.entries())
                              .filter(([, s]) => s.missing.size > 0)
                              .map(([dev, s]) => (
                                <div key={dev} className="text-amber-200">
                                  <span className="font-mono mr-1">⚠</span>
                                  {dev}: {s.matched}/{s.total} {t.statusAuto} · {t.missing}: {Array.from(s.missing).join(", ")}
                                </div>
                              ))}
                          </div>
                        )}

                        {inputNodes.length === 0 && <p className="text-[11px] text-slate-500">{t.noInputNodes}</p>}
                        <div className="space-y-2">
                          {rows.map(r => {
                            const statusColor: Record<BindingStatus, string> = {
                              auto: "text-green-400",
                              manual: "text-blue-400",
                              unselected: "text-slate-500",
                              "device-missing": "text-red-400",
                              "channel-missing": "text-amber-400",
                            };
                            const statusIcon: Record<BindingStatus, string> = {
                              auto: "✓",
                              manual: "✎",
                              unselected: "?",
                              "device-missing": "✗",
                              "channel-missing": "△",
                            };
                            const statusLabel: Record<BindingStatus, string> = {
                              auto: t.statusAuto,
                              manual: t.statusManual,
                              unselected: t.statusUnselected,
                              "device-missing": t.statusDeviceMissing,
                              "channel-missing": t.statusChannelMissing,
                            };
                            return (
                              <div key={r.node.id} className="border border-white/5 bg-slate-800/40 p-2 rounded space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="text-[11px] text-slate-300 w-1/3 truncate" title={r.sb ? `${r.sb.deviceName} / ${r.sb.channelName}` : ''}>
                                    {r.sb
                                      ? <><span className="text-slate-100">{r.sb.deviceName}</span> / <span className="text-slate-400">{r.sb.channelName}</span> <span className="text-slate-500">({r.sb.isAxis ? "axis" : "btn"})</span></>
                                      : <span className="italic text-slate-500">({t.statusUnselected})</span>}
                                  </div>
                                  <div className={`text-[11px] font-mono ${statusColor[r.status]} w-6 text-center`}>{statusIcon[r.status]}</div>
                                  <select
                                    className="bg-slate-800 border border-slate-700 px-2 py-1 text-[11px] flex-1"
                                    value={r.selectedKey ?? ""}
                                    onChange={e => setBindings(b => ({ ...b, [r.node.id]: e.target.value }))}
                                  >
                                    <option value="">{t.selectController}</option>
                                    {allChannels.map(c => (
                                      <option key={c.key} value={c.key}>{c.deviceName} — {c.channelName} ({c.isAxis ? "axis" : "button"})</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="text-[10px] text-slate-400 pl-1">
                                  <span className={statusColor[r.status]}>{statusLabel[r.status]}</span>
                                  {r.status === "device-missing" && r.sb && (
                                    <span className="ml-1 text-slate-500">— {r.sb.deviceName} {t.notOnTarget}</span>
                                  )}
                                  {r.status === "channel-missing" && r.sb && (
                                    <span className="ml-1 text-slate-500">— {t.availableOnTarget}: {r.availableChannels.map(channelLabel).join(", ") || "—"}</span>
                                  )}
                                  {r.status === "auto" && r.sb && (
                                    <span className="ml-1 text-slate-500">— {t.sameAsSource}</span>
                                  )}
                                  {r.status === "manual" && (
                                    <span className="ml-1 text-slate-500">— {t.userPicked}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>

                {result && (
                  <div className="border border-green-700/60 bg-green-900/20 p-3 rounded">
                    <div>{t.importOk(result.nodesCreated, result.edgesCreated, result.telemetrySubscribed)}</div>
                    {result.warnings.length > 0 && (
                      <div className="mt-2">
                        <div className="font-semibold text-amber-300">{t.importWarningsHeader(result.warnings.length)}</div>
                        <ul className="mt-1 list-disc list-inside text-[11px] text-amber-200 space-y-0.5">
                          {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowDialog(false)} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded text-xs">
                {t.cancel}
              </button>
              {template && (
                <button
                  onClick={handleApply}
                  disabled={busy}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs disabled:opacity-50"
                >
                  {busy ? t.importing : t.confirmImport}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}