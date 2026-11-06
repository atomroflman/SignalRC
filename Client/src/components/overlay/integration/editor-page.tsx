"use client";
// AP13 – the overlay editor page (/car/[carId]/overlay): AP09–AP12 editor with
// preview, real assets, sources, streams and video, publishing/history, the
// sending pause on opening and the keyboard separation (api/README.md §6).
import ConfigHeader from "@/components/config-header";
import { useVehicleAccess } from "@/components/vehicle-access";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useCarUiStore } from "../../car-ui-store";
import { useControlFlowStore } from "../../control-flow-store";
import VideoStream from "../../video-stream";
import { useI18n } from "@/i18n/provider";
import type { VideoStreamInfo } from "@/types/video-stream";
import { useEditorState } from "../editor/canvas/hooks";
import { dynamicsMessages } from "../editor/inspector/messages";
import { SignalsPanel } from "../editor/inspector/signals-panel";
import type { StreamInfo } from "../editor/canvas/variant-bar";
import type { EditorStore } from "../editor/core/store";
import type { SaveController } from "../editor/persistence/autosave";
import { HttpOverlayPersistence } from "../editor/persistence/http";
import { httpAssetUploader } from "../exchange/import";
import { packageSourceFor, type VehicleSources } from "../exchange/package";
import { PackageExchange } from "../exchange/package-exchange";
import { fetchVehicleSources } from "../exchange/vehicle";
import { OverlayEditorWithPreview } from "../preview/editor-with-preview";
import type { RuntimeAsset } from "../runtime/types";
import type { CarSourceProvider, HubLike } from "../sources";
import { sharedSourceHub } from "../sources";
import { TemplateInserter } from "../templates/template-inserter";
import { EditorAssetLoader, editorResolveContext, previewStream, withDraftAssetMetadata } from "./editor-assets";
import { loadFlowNames } from "./flow-signals";
import {
  controlReason, endLiveTest, installEditorKeyboardGuard, pauseOnEditorOpen, releaseForLiveTest, sendState,
  type MeLike, type PauseStoreLike,
} from "./editor-control";
import type { IntegrationMessages } from "./messages";
import { PublishPanel } from "./publish-panel";
import { SvgImportDialog } from "./svg-import-dialog";
import { DiagnosticsBody } from "./telemetry-diagnostics-panel";
import type { Size, VideoGeometry } from "./video-frame";

type EditorPageMessages = IntegrationMessages["editorPage"];

const flowStore = useControlFlowStore as unknown as PauseStoreLike;

function Section({ title, open, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="rounded border border-zinc-800 p-1" open={open}>
      <summary className="cursor-pointer select-none text-xs font-semibold text-zinc-300">{title}</summary>
      <div className="mt-1">{children}</div>
    </details>
  );
}

/** Control banner: sending state and the deliberate live-test release. */
function SendBanner({ carId }: { carId: number }) {
  const { messages } = useI18n();
  const m = messages.overlay.editorPage;
  const state = useControlFlowStore((s) => sendState(s, carId));
  const configMode = useControlFlowStore((s) => s.isInConfigMode);
  const tone = state === "live" ? "border-red-600 bg-red-950 text-red-100" : state === "paused" ? "border-amber-700 bg-amber-950/70 text-amber-100" : "border-zinc-700 bg-zinc-900 text-zinc-300";
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${tone}`} role="status" data-ovl-send-state={state}>
      <span className="font-semibold">
        {state === "live" ? `● ${m.sendLive}` : state === "paused" ? `⏸ ${configMode ? m.sendPausedConfig : m.sendPaused}` : m.noSession}
      </span>
      {state === "paused" && !configMode && (
        <button className="ml-auto rounded border border-red-700 bg-red-900 px-2 py-0.5 text-white hover:bg-red-800" onClick={() => releaseForLiveTest(flowStore)}>
          {m.releaseLiveTest}
        </button>
      )}
      {state === "live" && (
        <button className="ml-auto rounded border border-amber-600 bg-amber-700 px-2 py-0.5 text-white hover:bg-amber-600" onClick={() => endLiveTest(flowStore)}>
          {m.endLiveTest}
        </button>
      )}
    </div>
  );
}

function storedStreamId(carId: number): number | undefined {
  try {
    const v = Number(window.localStorage.getItem(`lastSelectedStreamId:${carId}`));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Outline of the displayed video frame with its received size, so the workspace (dashed, preview) can be compared with it. */
export function VideoFrameMark({ geometry, workspace, m }: { geometry: VideoGeometry; workspace: Size; m: EditorPageMessages }) {
  const { frame, media } = geometry;
  const label = `${frame ? m.videoFrame(media.width, media.height) : m.noVideoFrame} · ${m.workspaceSize(workspace.width, workspace.height)}`;
  return (
    <>
      {frame && <div className="absolute inset-0 border border-sky-400/80" data-ovl-video-frame="" />}
      <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-sky-200" data-ovl-video-size={frame ? `${media.width}x${media.height}` : ""}>
        {label}
      </div>
    </>
  );
}

function PreviewVideo({ carId, store, streams, hud, m }: { carId: number; store: EditorStore; streams: VideoStreamInfo[]; hud: ReactNode; m: EditorPageMessages }) {
  const state = useEditorState(store);
  const stream = previewStream(streams, state.activeVariant, storedStreamId(carId));
  if (!stream) {
    return (
      <>
        {hud}
        <div className="pointer-events-none absolute bottom-1 left-1 text-[11px] text-zinc-500">{m.noVideo}</div>
      </>
    );
  }
  // Without a received frame (vehicle not sending, Janus down) the HUD stays on the fitted workspace.
  const workspace = store.effective().workspace;
  const layer = (geometry: VideoGeometry) => (
    <>
      {hud}
      <VideoFrameMark geometry={geometry} workspace={workspace} m={m} />
    </>
  );
  return (
    <div className="absolute inset-0 flex bg-black">
      <VideoStream key={stream.serverId} streamId={stream.serverId} streamName={stream.name} frameLayer={layer} frameLayerFallback={workspace} />
    </div>
  );
}

const HUD_TABS = ["editor", "diagnostics"] as const;
type HudTab = typeof HUD_TABS[number];

export function OverlayEditorPage({ carId }: { carId: number }) {
  const { messages, locale } = useI18n();
  const m = messages.overlay;
  const [tab, setTab] = useState<HudTab>("editor");
  const [me, setMe] = useState<MeLike | null | undefined>(undefined);
  const connectCarUi = useCarUiStore((s) => s.connect);
  const carState = useCarUiStore((s) => s.states[carId]);
  // A config session manages the HUD like the driver, also while the vehicle is offline (Docs/VehicleKeyAuth.md).
  const { access } = useVehicleAccess(carId);
  const reason = access?.configure ? "control" : controlReason(me, carState);
  const hasControl = reason === "control";

  // Opening pauses sending; leaving never reactivates (api/README.md §6).
  useEffect(() => { pauseOnEditorOpen(flowStore); }, [carId]);
  // Editor keys never reach window-level vehicle input handlers.
  useEffect(() => installEditorKeyboardGuard(document), []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setMe(d ?? null); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { void connectCarUi(); }, [connectCarUi]);

  // Own hub connection for draft/publication events and the stream list.
  const [hub, setHub] = useState<HubLike & { stop(): Promise<void> } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let conn: (HubLike & { start(): Promise<void>; stop(): Promise<void> }) | undefined;
    void (async () => {
      const signalR = await import("@microsoft/signalr");
      conn = new signalR.HubConnectionBuilder().withUrl("/hubs/connection").withAutomaticReconnect().build() as unknown as typeof conn;
      try {
        await conn!.start();
        if (active) setHub(conn);
        else await conn!.stop();
      } catch (e) {
        console.error("Overlay editor: hub connection failed", e);
      }
    })();
    return () => {
      active = false;
      setHub(undefined);
      void conn?.stop().catch(() => {});
    };
  }, []);
  // Assets: texts by GET assets/{id}, stored metadata with every loaded draft (GET draft `assets`).
  const { persistence, loader } = useMemo(() => {
    if (!hub) return { persistence: undefined, loader: undefined };
    const http = new HttpOverlayPersistence({ hub });
    const assetLoader = new EditorAssetLoader({ getAsset: (id) => http.getAsset(carId, id) });
    return { persistence: withDraftAssetMetadata(http, (m) => assetLoader.addMetadata(m)), loader: assetLoader };
  }, [hub, carId]);

  const [videoStreams, setVideoStreams] = useState<VideoStreamInfo[]>([]);
  useEffect(() => {
    if (!hub) return;
    let cancelled = false;
    const load = () => hub.invoke("GetVideoStreamsForCar", carId)
      .then((r) => { if (!cancelled) setVideoStreams((r as VideoStreamInfo[] | null) ?? []); })
      .catch((e) => console.error("Overlay editor: streams", e));
    void load();
    hub.onreconnected?.(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; };
  }, [hub, carId]);
  const streams = useMemo<StreamInfo[]>(
    () => videoStreams.map((s) => ({ streamId: s.streamId, name: s.name, width: s.width, height: s.height })),
    [videoStreams],
  );

  const [vehicle, setVehicle] = useState<VehicleSources | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchVehicleSources(carId, streams)
      .then((v) => { if (!cancelled) setVehicle(v); })
      .catch(() => { if (!cancelled) setVehicle({ telemetry: [], outputs: [], streams }); });
    return () => { cancelled = true; };
  }, [carId, streams]);

  // Names of the own flow's HUD-Signal and HUD-Eingabe nodes; undefined until loaded (or when loading failed).
  const [flowSignals, setFlowSignals] = useState<string[] | undefined>(undefined);
  const [flowInputs, setFlowInputs] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const fetchJson = (url: string) => fetch(url, { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));
    loadFlowNames(carId, fetchJson)
      .then((names) => { if (!cancelled) { setFlowSignals(names.signals); setFlowInputs(names.inputs); } })
      .catch((e) => console.warn("Overlay editor: flow signals", e));
    return () => { cancelled = true; };
  }, [carId]);
  const signalChannels = useMemo(() => ({ flowSignals }), [flowSignals]);

  const [live, setLive] = useState<CarSourceProvider | undefined>(undefined);
  useEffect(() => {
    const car = sharedSourceHub().acquire(carId);
    setLive(car.provider);
    return () => {
      setLive(undefined);
      car.release();
    };
  }, [carId]);

  useEffect(() => () => loader?.dispose(), [loader]);
  const noAssets = useMemo<Record<string, RuntimeAsset>>(() => ({}), []);
  const assets = useSyncExternalStore(
    useCallback((l: () => void) => loader?.subscribe(l) ?? (() => {}), [loader]),
    () => loader?.current ?? noAssets,
    () => noAssets,
  );
  const addAssets = useCallback((a: Record<string, RuntimeAsset>) => loader?.add(a), [loader]);

  const [api, setApi] = useState<{ store: EditorStore; save: SaveController } | null>(null);
  useEffect(() => {
    if (!api || !loader) return;
    const ensure = () => { void loader.ensure(api.store.document); };
    ensure();
    return api.store.subscribe(ensure);
  }, [api, loader]);
  useEffect(() => {
    if (hasControl && loader && api) {
      loader.retryFailed();
      void loader.ensure(api.store.document);
    }
  }, [hasControl, loader, api]);

  const resolveContext = useMemo(() => editorResolveContext(vehicle, assets), [vehicle, assets]);
  const latest = useRef({ vehicle, streams, store: api?.store });
  latest.current = { vehicle, streams, store: api?.store };
  const packageSource = useCallback(() => {
    const { vehicle: v, streams: s, store } = latest.current;
    const target = v ?? { telemetry: [], outputs: [], streams: s };
    return store ? packageSourceFor(store.document, target) : { streams: s, telemetry: [], outputs: [] };
  }, []);
  const getAsset = useCallback((id: string) => persistence!.getAsset(carId, id), [persistence, carId]);
  const upload = useMemo(() => httpAssetUploader(carId), [carId]);
  const videoLayer = useCallback(
    (hud: ReactNode) => (api ? <PreviewVideo carId={carId} store={api.store} streams={videoStreams} hud={hud} m={m.editorPage} /> : hud),
    [api, carId, videoStreams, m.editorPage],
  );
  const onReady = useCallback((a: { store: EditorStore; save: SaveController }) => setApi(a), []);

  const ready = me !== undefined && persistence !== undefined;

  return (
    <div className="flex min-h-screen flex-col gap-2 bg-zinc-950 p-4 text-zinc-100" data-ovl-editor-page={carId}>
      <ConfigHeader carId={carId} active="hud" className="mb-2"
        actions={<span className="text-[11px] text-zinc-500">{m.editorPage.keyboardHint}</span>} />
      <SendBanner carId={carId} />
      <div role="tablist" aria-label={m.editorPage.tabsLabel} className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-zinc-800">
        {HUD_TABS.map(t => (
          <button
            key={t}
            role="tab"
            id={`hud-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`hud-tab-panel-${t}`}
            className={`shrink-0 px-3 py-1.5 text-xs border-b-2 ${tab === t ? "border-green-500 text-zinc-100" : "border-transparent text-zinc-400 hover:text-zinc-200"}`}
            onClick={() => setTab(t)}
          >
            {m.editorPage.tabs[t]}
          </button>
        ))}
      </div>
      {tab === "diagnostics" && (
        <div id="hud-tab-panel-diagnostics" role="tabpanel" aria-labelledby="hud-tab-diagnostics" className="text-xs">
          <DiagnosticsBody carId={carId} provider={live} m={m.telemetryDiagnostics} />
        </div>
      )}
      {/* Hidden, not unmounted: the editor keeps its store, autosave and preview while diagnostics are shown. */}
      <div id="hud-tab-panel-editor" role="tabpanel" aria-labelledby="hud-tab-editor" className={`flex flex-1 flex-col gap-2 ${tab === "editor" ? "" : "hidden"}`}>
      {me !== undefined && reason !== "control" && <div className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300" data-ovl-local-only={reason}>{m.editorPage.localOnly[reason]}</div>}
      {!ready && <div className="text-xs text-zinc-400">{m.editorPage.loading}</div>}
      {ready && (
        <OverlayEditorWithPreview
          carId={carId}
          persistence={persistence!}
          hasControl={hasControl}
          locale={locale}
          streams={streams}
          assets={assets}
          resolveContext={resolveContext}
          flowSignals={flowSignals}
          flowInputs={flowInputs}
          liveSource={live}
          packageSource={packageSource}
          videoLayer={videoLayer}
          onReady={onReady}
          className="flex-1"
        >
          {api && (
            <>
              <Section title={m.publish.title} open>
                <PublishPanel carId={carId} store={api.store} save={api.save} persistence={persistence!} locale={locale} m={m.publish} reason={reason} />
              </Section>
              <Section title={(dynamicsMessages[locale] ?? dynamicsMessages.de).signalPanel}>
                <SignalsPanel store={api.store} locale={locale} channels={signalChannels} />
              </Section>
              <Section title={m.templates.title}>
                <TemplateInserter store={api.store} locale={locale} channels={vehicle?.telemetry ?? []} />
              </Section>
              <Section title={m.editorPage.exchange}>
                <PackageExchange store={api.store} carId={carId} locale={locale} vehicle={vehicle} assets={assets}
                  getAsset={getAsset} upload={upload} onAssets={addAssets} canImport={hasControl} />
              </Section>
              <Section title={m.svgImport.title}>
                <SvgImportDialog store={api.store} carId={carId} locale={locale} m={m.svgImport} canImport={hasControl} onAsset={addAssets} />
              </Section>
            </>
          )}
        </OverlayEditorWithPreview>
      )}
      </div>
    </div>
  );
}

export default OverlayEditorPage;
