"use client";
// AP13 – SVG import in the editor: file → server sanitizing (AP07 upload) →
// preview of the sanitized output with explicit confirmation → the asset goes
// into the page's asset map and an svgAsset element is inserted by an editor
// command (one undo step). The original file is never rendered.
import React, { useRef, useState } from "react";
import { SvgImportPreview } from "../assets/svg-import-preview";
import { uploadSvgAsset } from "../assets/svg-asset";
import type { AssetUploadResult, SvgImportState } from "../assets/types";
import type { EditorStore } from "../editor/core/store";
import { newElement, newElementId } from "../editor/core/tools";
import type { Locale, RuntimeAsset } from "../runtime/types";
import type { IntegrationMessages } from "./messages";

const btn = "px-2 py-0.5 rounded text-xs border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40";

/** Inserts an uploaded asset in the workspace center (inside the entered group); returns the element id. */
export function insertAssetElement(store: EditorStore, result: Pick<AssetUploadResult, "assetId" | "metadata">): string | undefined {
  const ws = store.effective().workspace;
  const container = store.getState().view.enteredGroup ?? undefined;
  const w = result.metadata.width;
  const h = result.metadata.height;
  const at = container ? { x: 0, y: 0 } : { x: (ws.width - w) / 2, y: (ws.height - h) / 2 };
  const id = newElementId(store);
  const el = { ...newElement("svgAsset", at), assetId: result.assetId };
  const r = store.dispatch({ type: "addElements", elements: { [id]: el }, roots: [id], container }, { label: "SVG importieren" });
  if (!r.ok) return undefined;
  store.select([id]);
  return id;
}

export interface SvgImportDialogProps {
  store: EditorStore;
  carId: number;
  locale: Locale;
  m: IntegrationMessages["svgImport"];
  canImport: boolean;
  /** Called before the element is inserted, so the asset is known when rendering. */
  onAsset: (assets: Record<string, RuntimeAsset>) => void;
  /** Upload; default POST …/overlay/assets (tests). */
  upload?: (carId: number, file: File) => Promise<SvgImportState>;
}

export function SvgImportDialog({ store, carId, locale, m, canImport, onAsset, upload = uploadSvgAsset }: SvgImportDialogProps) {
  const [state, setState] = useState<SvgImportState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setNotice(null);
    setState({ kind: "uploading", fileName: file.name });
    setState(await upload(carId, file));
  };

  const confirm = (result: AssetUploadResult) => {
    onAsset({ [result.assetId]: { svg: result.svg, metadata: result.metadata } });
    const id = insertAssetElement(store, result);
    setNotice(id ? m.inserted : m.insertFailed);
    setState(null);
  };

  return (
    <div className="flex flex-col gap-1 text-xs" data-ovl-svg-import="">
      <div className="font-semibold text-zinc-300">{m.title}</div>
      <input ref={fileRef} type="file" accept=".svg,image/svg+xml" className="hidden"
        onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
      <button className={btn} disabled={!canImport || state?.kind === "uploading"} onClick={() => fileRef.current?.click()}>{m.choose}</button>
      {!canImport && <div className="text-zinc-500">{m.noControl}</div>}
      {notice && <div className="text-zinc-400" role="status">{notice}</div>}
      {state && <SvgImportPreview state={state} locale={locale} onCancel={() => setState(null)} onConfirm={confirm} />}
    </div>
  );
}
