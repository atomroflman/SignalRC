"use client";
// AP12 – export button and import dialog. All draft changes go through the
// editor store (replaceDocument); saving stays with the AP09 SaveController.
import React, { useMemo, useState } from "react";
import { effectiveConfig } from "../document/resolve";
import type { Diagnostic, OverlayDocument } from "../document/types";
import type { EditorStore } from "../editor/core/store";
import { downloadPackage } from "../editor/persistence/backup";
import { OverlayRenderer } from "../runtime/overlay-renderer";
import type { Locale, RuntimeAsset } from "../runtime/types";
import {
  commitImport, evaluateImport, prepareImport, suggestMapping, type AssetUploader, type ImportMapping, type PreparedImport,
} from "./import";
import { exchangeMessages, type ExchangeMessages } from "./messages";
import { collectAssetTexts, exportPackage, LIMITS, parsePackage, type VehicleSources } from "./package";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";
const select = "bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-xs text-zinc-100 max-w-[14rem]";

export interface PackageExchangeProps {
  store: EditorStore;
  carId: number;
  locale: Locale;
  /** Target vehicle: channel catalog (AP05) and streams; null while loading. */
  vehicle: VehicleSources | null;
  /** Assets already loaded by the host (normalized texts). */
  assets?: Record<string, RuntimeAsset>;
  /** Loads an asset text not in `assets` (AP02 GET assets/{id}). */
  getAsset: (assetId: string) => Promise<string>;
  /** Server sanitizing of imported assets (httpAssetUploader). */
  upload: AssetUploader;
  /** New sanitized assets after an import, for the host's asset map. */
  onAssets?: (assets: Record<string, RuntimeAsset>) => void;
  /** False without vehicle control: uploads are not possible. */
  canImport?: boolean;
}

/** Readable location of a diagnostic: element name, variant, property. */
export function describeLocation(doc: OverlayDocument, d: Diagnostic): string {
  const l = d.location;
  const parts: string[] = [];
  if (l.variant) parts.push(`[${l.variant}]`);
  if (l.element) {
    const el = doc.elements[l.element] ?? (l.variant ? doc.variants?.[l.variant]?.addedElements?.[l.element] : undefined);
    parts.push(el?.name ? `${el.name} (${l.element})` : l.element);
  }
  if (l.clip) parts.push(`Clip ${doc.clips?.[l.clip]?.name ?? l.clip}`);
  if (l.part) parts.push(l.part);
  if (l.property) parts.push(l.property);
  if (l.field) parts.push(l.field);
  return parts.join(" · ");
}

export function PackageExchange(props: PackageExchangeProps) {
  const { store, carId, locale } = props;
  const m = exchangeMessages[locale] ?? exchangeMessages.de;
  const [busy, setBusy] = useState<"export" | "read" | "upload" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);

  const doExport = async () => {
    setBusy("export");
    setError(null);
    try {
      const known = Object.fromEntries(Object.entries(props.assets ?? {}).map(([id, a]) => [id, a.svg]));
      const { texts } = await collectAssetTexts(store.document, known, props.getAsset);
      const vehicle = props.vehicle ?? { telemetry: [], outputs: [], streams: [] };
      const result = exportPackage(store.document, texts, vehicle);
      if (result.ok) downloadPackage(carId, result.package);
      else setError(m.errors.PKG_ASSETS_MISSING);
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > LIMITS.fileBytes) {
      setError(m.errors.PKG_TOO_LARGE);
      return;
    }
    setBusy("read");
    try {
      let text: string;
      try {
        text = await file.text();
      } catch {
        setError(m.errors.PKG_READ);
        return;
      }
      const parsed = parsePackage(text);
      if (!parsed.ok) {
        setError(m.errors[parsed.code]);
        return;
      }
      setBusy("upload");
      const result = await prepareImport(parsed.package, props.upload, parsed.issues);
      if (!result.ok) setError(m.errors.PKG_DOCUMENT_INVALID);
      else setPrepared(result.import);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-1 text-xs" data-ovl-exchange>
      <div className="flex flex-wrap items-center gap-1">
        <button className={btn} disabled={busy !== null} onClick={() => void doExport()}>{busy === "export" ? m.exporting : m.export}</button>
        <label className={`${btn} cursor-pointer ${props.canImport === false || busy !== null ? "opacity-40 pointer-events-none" : ""}`} title={props.canImport === false ? m.noControl : undefined}>
          {m.import}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            disabled={props.canImport === false || busy !== null}
            onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
          />
        </label>
        {busy === "read" && <span className="text-zinc-400">{m.reading}</span>}
        {busy === "upload" && <span className="text-zinc-400">{m.uploading}</span>}
      </div>
      {error && <div className="text-red-300" role="alert">{error}</div>}
      {prepared && (
        <ImportDialog
          prepared={prepared}
          vehicle={props.vehicle}
          locale={locale}
          m={m}
          onCancel={() => setPrepared(null)}
          onConfirm={(mapping) => {
            if (!props.vehicle) return;
            const evaluation = evaluateImport(prepared, mapping, props.vehicle);
            const r = commitImport(store, evaluation);
            if (r.ok) {
              props.onAssets?.(prepared.assets);
              setPrepared(null);
            } else {
              setError(r.error.message);
            }
          }}
        />
      )}
    </div>
  );
}

interface ImportDialogProps {
  prepared: PreparedImport;
  vehicle: VehicleSources | null;
  locale: Locale;
  m: ExchangeMessages;
  onCancel: () => void;
  onConfirm: (mapping: ImportMapping) => void;
}

export function ImportDialog({ prepared, vehicle, locale, m, onCancel, onConfirm }: ImportDialogProps) {
  const [mapping, setMapping] = useState<ImportMapping | null>(() => (vehicle ? suggestMapping(prepared, vehicle) : null));
  const current = mapping ?? (vehicle ? suggestMapping(prepared, vehicle) : null);
  const evaluation = useMemo(() => (vehicle && current ? evaluateImport(prepared, current, vehicle) : null), [prepared, vehicle, current]);
  const config = useMemo(() => (evaluation ? effectiveConfig(evaluation.document, null) : null), [evaluation]);

  const set = (kind: keyof ImportMapping, from: string, to: string) => {
    if (!current) return;
    setMapping({ ...current, [kind]: { ...current[kind], [from]: to } });
  };
  const sourceTel = new Map(prepared.source.telemetry.map((t) => [t.name, t]));
  const refs = prepared.references;

  return (
    <div className="rounded border border-sky-800 bg-zinc-950 p-2 flex flex-col gap-2" role="dialog" aria-label={m.importTitle} data-ovl-import-dialog>
      <strong>{m.importTitle}</strong>
      <span className="text-zinc-400">
        {prepared.kind === "backup" ? m.kindBackup(prepared.baseRevision) : m.kindExport(prepared.exportedAt)} · {m.draftOnly}
      </span>
      {!vehicle && <span className="text-zinc-400">{m.noVehicle}</span>}
      {vehicle && current && (
        <>
          <MappingTable
            title={m.telemetry}
            m={m}
            rows={Object.entries(refs.telemetry).map(([name, uses]) => {
              const src = sourceTel.get(name);
              // A LiDAR grid only maps onto a grid channel, a formula channel only onto a formula channel.
              const options = src?.dataType ? vehicle.telemetry.filter((t) => (t.dataType === "LidarGrid") === (src.dataType === "LidarGrid")) : vehicle.telemetry;
              return {
                from: name,
                hint: [src?.dataType, src?.unit, m.uses(uses)].filter(Boolean).join(", "),
                options: options.map((t) => ({ value: t.name, label: `${t.name} (${[t.dataType, t.unit].filter(Boolean).join(", ")})` })),
                value: current.telemetry[name] ?? "",
              };
            })}
            onChange={(from, to) => set("telemetry", from, to)}
          />
          <MappingTable
            title={m.outputs}
            m={m}
            rows={Object.entries(refs.outputs).map(([name, uses]) => ({
              from: name, hint: m.uses(uses), options: vehicle.outputs.map((o) => ({ value: o, label: o })), value: current.outputs[name] ?? "",
            }))}
            onChange={(from, to) => set("outputs", from, to)}
          />
          <MappingTable
            title={m.streams}
            m={m}
            rows={refs.streams.map((id) => {
              const src = prepared.source.streams.find((s) => s.streamId === id);
              return {
                from: id,
                hint: [src?.name, src?.width && src?.height ? `${src.width}×${src.height}` : undefined].filter(Boolean).join(", "),
                options: vehicle.streams.map((s) => ({ value: s.streamId, label: s.name ? `${s.name} (${s.streamId})` : s.streamId })),
                value: current.streams[id] ?? "",
              };
            })}
            onChange={(from, to) => set("streams", from, to)}
          />
        </>
      )}
      {prepared.assetIssues.length > 0 && (
        <ul className="text-amber-300 list-disc pl-4" data-ovl-import-asset-issues>
          {prepared.assetIssues.map((i) => <li key={i.ref}>{m.assetIssue(i)}</li>)}
        </ul>
      )}
      {evaluation && (
        <>
          {evaluation.error && <div className="text-red-300">{m.errors[evaluation.error.code]}</div>}
          {evaluation.unresolved.length > 0 && (
            <div data-ovl-import-unresolved>
              <span className="text-zinc-300">{m.unresolvedTitle}</span>
              <ul className="list-disc pl-4 text-amber-200">
                {evaluation.unresolved.map((u) => <li key={`${u.kind}:${u.name}`}>{m.unresolved(u)}</li>)}
              </ul>
            </div>
          )}
          {evaluation.blocking.length > 0 ? (
            <div data-ovl-import-blocking={evaluation.blocking.length}>
              <span className="text-red-300">{m.blockingTitle(evaluation.blocking.length)}</span>
              <ul className="list-disc pl-4 text-red-200 max-h-32 overflow-auto">
                {evaluation.blocking.map((d, i) => <li key={i}>{describeLocation(evaluation.document, d)}: {d.message}</li>)}
              </ul>
            </div>
          ) : (
            evaluation.canSave && <span className="text-emerald-400">{m.publishable}</span>
          )}
          {!evaluation.canSave && !evaluation.error && <span className="text-red-300">{m.structureInvalid}</span>}
          {config && (
            <div>
              <span className="text-zinc-400">{m.preview}</span>
              <OverlayRenderer
                config={config}
                assets={prepared.assets}
                mode="design"
                locale={locale}
                className="w-full max-h-64 border border-zinc-800 bg-zinc-900"
                idPrefix="ovl-import-"
              />
            </div>
          )}
        </>
      )}
      <div className="flex gap-2 justify-end">
        <button className={btn} onClick={onCancel}>{m.cancel}</button>
        <button className={btn} disabled={!evaluation?.canSave || !current} onClick={() => current && onConfirm(current)}>{m.confirm}</button>
      </div>
    </div>
  );
}

interface MappingRow {
  from: string;
  hint: string;
  options: { value: string; label: string }[];
  value: string;
}

function MappingTable({ title, rows, m, onChange }: { title: string; rows: MappingRow[]; m: ExchangeMessages; onChange: (from: string, to: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <table className="w-full text-xs" data-ovl-mapping={title}>
      <caption className="text-left text-zinc-300">{title}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.from}>
            <td className="pr-2 font-mono">{r.from}<div className="text-zinc-500 font-sans">{r.hint}</div></td>
            <td className="text-zinc-500">→</td>
            <td>
              <select className={select} value={r.value} onChange={(e) => onChange(r.from, e.target.value)} data-ovl-map-from={r.from}>
                <option value="">{m.keep}</option>
                {r.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
