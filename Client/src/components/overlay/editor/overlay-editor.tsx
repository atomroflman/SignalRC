"use client";
// AP09 – embeddable editor: design surface, layers, transform panel, variants,
// undo/redo and autosave. No route, navigation or control pause here (AP13);
// AP10–AP12 attach to the same store (see README.md).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { DeletionImpact } from "../document/deletion";
import type { ResolveContext } from "../document/types";
import type { RendererSource } from "../runtime/controller";
import type { Locale, RuntimeAsset } from "../runtime/types";
import type { ChannelMetadata } from "../sources/types";
import { EditorStore } from "./core/store";
import { defaultBackupStore, type BackupStore, type PackageSource } from "./persistence/backup";
import { SaveController } from "./persistence/autosave";
import type { OverlayPersistence } from "./persistence/types";
import { deleteNow, disableInVariant, duplicateSelection, groupSelection, planDelete, ungroupSelection } from "./canvas/actions";
import { DesignCanvas } from "./canvas/design-canvas";
import { editorMessages } from "./canvas/messages";
import { LayersPanel, TransformPanel } from "./canvas/panels";
import { DeleteDialog, SaveNotices, SaveStatus } from "./canvas/save-ui";
import { Toolbar } from "./canvas/toolbar";
import { VariantBar, type StreamInfo } from "./canvas/variant-bar";
import { channelDirectory, type ChannelDirectory } from "./inspector/channels";
import { PropertyInspector } from "./inspector/property-inspector";
import { TimelinePanel } from "./timeline/timeline-panel";

export interface OverlayEditorProps {
  carId: number;
  persistence: OverlayPersistence;
  /** Whether this client is the active driver (CarStateUpdated); false blocks server access. */
  hasControl: boolean;
  locale: Locale;
  streams?: StreamInfo[];
  /** Browser backups; IndexedDB by default. */
  backups?: BackupStore;
  /** Normalized assets by id (AP07), for rendering, sizes and backups. */
  assets?: Record<string, RuntimeAsset>;
  /** Sources, streams and expression analyzer for diagnostics (AP01/AP06). */
  resolveContext?: ResolveContext;
  /** Read-only live values in design mode (AP05). */
  source?: RendererSource;
  /** Channels with unit/decimals for bindings (AP10); default: the source provider's channels or resolveContext.sources. */
  channels?: ChannelDirectory;
  packageSource?: () => PackageSource;
  /** Gives the host (AP10–AP13) access to the store and the save controller. */
  onReady?: (api: { store: EditorStore; save: SaveController }) => void;
  /** Extra panels (inspector, timeline) rendered beside the transform panel. */
  children?: React.ReactNode;
  className?: string;
}

export function OverlayEditor(props: OverlayEditorProps) {
  const { carId, persistence, locale } = props;
  const m = editorMessages[locale] ?? editorMessages.de;
  const store = useMemo(
    () => new EditorStore({ carId, document: { schemaVersion: 1, workspace: { width: 1920, height: 1080 }, elements: {}, children: [] } }),
    [carId],
  );
  const [save, setSave] = useState<SaveController | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; impact: DeletionImpact } | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [clip, setClip] = useState<string | undefined>();
  const source = props.source as (RendererSource & { channels?: () => ChannelMetadata[]; subscribe?: (l: () => void) => () => void }) | undefined;
  // The provider loads its channel metadata asynchronously.
  const [channelCount, setChannelCount] = useState(0);
  useEffect(() => {
    if (props.channels || !source?.channels || !source.subscribe) return;
    setChannelCount(source.channels().length);
    return source.subscribe(() => setChannelCount(source.channels!().length));
  }, [props.channels, source]);
  const channels = useMemo(
    () => props.channels ?? channelDirectory({ channels: source?.channels?.(), sources: props.resolveContext?.sources }),
    // channelCount re-reads the provider after its metadata arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.channels, source, props.resolveContext, channelCount],
  );

  useEffect(() => {
    const assets = props.assets;
    const controller = new SaveController({
      store,
      persistence,
      backups: props.backups ?? defaultBackupStore(),
      hasControl: props.hasControl,
      assetTexts: () => Object.fromEntries(Object.entries(assets ?? {}).map(([id, a]) => [id, a.svg])),
      source: props.packageSource,
    });
    setSave(controller);
    void controller.open();
    const onUnload = () => { void controller.flushBackup(); };
    window.addEventListener("beforeunload", onUnload);
    props.onReady?.({ store, save: controller });
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      controller.dispose();
    };
    // The controller lives as long as store and persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, persistence]);

  useEffect(() => { save?.setControl(props.hasControl); }, [save, props.hasControl]);
  useEffect(() => {
    store.setGeometryContext({ assets: props.assets, locale });
  }, [store, props.assets, locale]);
  useEffect(() => {
    if (props.resolveContext) store.setResolveContext(props.resolveContext);
  }, [store, props.resolveContext]);

  const requestDelete = useCallback(() => {
    const plan = planDelete(store);
    if (plan.kind === "direct") deleteNow(store, plan.ids);
    else if (plan.kind === "confirm") setConfirm({ ids: plan.ids, impact: plan.impact });
    else if (plan.kind === "inherited") disableInVariant(store, plan.ids);
  }, [store]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (mod && key === "z" && !e.shiftKey) { e.preventDefault(); store.undo(); }
    else if (mod && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); store.redo(); }
    else if (mod && key === "d") { e.preventDefault(); duplicateSelection(store); }
    else if (mod && key === "g" && e.shiftKey) { e.preventDefault(); ungroupSelection(store); }
    else if (mod && key === "g") { e.preventDefault(); groupSelection(store); }
    else if (mod && key === "s") { e.preventDefault(); void save?.flush(); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); requestDelete(); }
    else if (e.key === "Escape") { store.select([]); store.setView({ enteredGroup: null }); }
  };

  return (
    <div className={`relative flex flex-col gap-2 text-zinc-100 min-h-0 ${props.className ?? ""}`} data-ovl-editor={carId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Toolbar store={store} m={m} onDelete={requestDelete} onFit={() => setFitKey((k) => k + 1)} />
        {save && <SaveStatus save={save} m={m} carId={carId} />}
      </div>
      {save && <SaveNotices save={save} m={m} carId={carId} />}
      <VariantBar store={store} m={m} streams={props.streams ?? []} />
      <div className="flex gap-2 min-h-0 flex-1">
        <div className="w-56 shrink-0 overflow-auto rounded border border-zinc-800 p-1"><LayersPanel store={store} m={m} /></div>
        <DesignCanvas key={fitKey} store={store} assets={props.assets} locale={locale} source={props.source} onKeyDown={onKeyDown} className="flex-1 min-h-[300px] rounded border border-zinc-800" />
        <div className="w-72 shrink-0 overflow-auto rounded border border-zinc-800 p-2 flex flex-col gap-2">
          <TransformPanel store={store} m={m} />
          <PropertyInspector store={store} locale={locale} channels={channels} source={props.source} activeClip={clip} onOpenClip={setClip} />
          {props.children}
        </div>
      </div>
      <TimelinePanel store={store} locale={locale} channels={channels} source={props.source} clip={clip} onSelectClip={setClip}
        className="max-h-[40vh] overflow-auto rounded border border-zinc-800 p-2" />
      {confirm && (
        <DeleteDialog
          impact={confirm.impact}
          m={m}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { deleteNow(store, confirm.ids); setConfirm(null); }}
        />
      )}
    </div>
  );
}

export default OverlayEditor;
