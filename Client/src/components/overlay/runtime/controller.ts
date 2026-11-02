// Connects runtime, scene, clock, source and DOM: display sessions (runtime §2),
// source requirements and frame scheduling. Framework-free so it is testable
// with a fake DOM; the React component is a thin wrapper.
import type { EffectiveConfig } from "../document/types";
import type { OverlaySourceProvider, OverlayValueSource, Requirement } from "../sources/types";
import { createRuntime, type Runtime, type RuntimeSource } from "./runtime";
import { SceneBuilder } from "./scene";
import type { Clock, FrameResult, Locale, RenderMode, RuntimeAsset, RuntimeDiagnostic, Scrub } from "./types";
import { create, patch, type DomDocument, type DomNode, type VNode } from "./vnode";

/** A plain value source, or a provider whose requirement the controller manages. */
export type RendererSource = RuntimeSource | OverlayValueSource | OverlaySourceProvider;

export interface ControllerOptions {
  config: EffectiveConfig;
  assets?: Record<string, RuntimeAsset>;
  source?: RendererSource;
  clock: Clock;
  mode: RenderMode;
  locale: Locale;
  /** Design mode only. */
  scrub?: Scrub;
  pxPerUnit?: number;
  idPrefix?: string;
  onDiagnostics?: (diagnostics: RuntimeDiagnostic[]) => void;
  /** Called after every rendered frame (editor inspection, tests). */
  onFrame?: (frame: FrameResult) => void;
}

const NO_ASSETS: Record<string, RuntimeAsset> = {};

/** Without any source every value is missing (invalid). */
const NULL_SOURCE: RuntimeSource = {
  get: () => ({ state: "invalid" }),
  driverActive: () => false,
  lidarGrid: () => ({ state: "invalid" }),
};

const isProvider = (s: RendererSource | undefined): s is OverlaySourceProvider =>
  !!s && typeof (s as OverlaySourceProvider).require === "function";

const subscribable = (s: RendererSource | undefined): s is RendererSource & { subscribe(l: () => void): () => void } =>
  !!s && typeof (s as { subscribe?: unknown }).subscribe === "function";

let consumerCounter = 0;

export class OverlayController {
  private options: ControllerOptions;
  private runtime!: Runtime;
  private scene!: SceneBuilder;
  private shown = true;
  private session: { stopFrames?: () => void; unsubscribe?: () => void; requirement?: Requirement; source: RuntimeSource } | undefined;
  private pendingFrame: (() => void) | undefined;
  private vnode: VNode | undefined;
  private dom: DomNode | undefined;
  private lastDiagnostics = "";
  private disposed = false;
  readonly consumerId = `overlay-hud-${++consumerCounter}`;

  constructor(private readonly host: DomNode, private readonly doc: DomDocument, options: ControllerOptions) {
    this.options = options;
    this.compile();
    this.start();
  }

  update(next: Partial<ControllerOptions>) {
    if (this.disposed) return;
    const prev = this.options;
    this.options = { ...prev, ...next };
    const o = this.options;
    const recompile = o.config !== prev.config;
    const restart = recompile || o.mode !== prev.mode || o.source !== prev.source || o.clock !== prev.clock;
    if (recompile) {
      this.stop();
      this.compile();
    } else {
      if (o.locale !== prev.locale) this.runtime.setLocale(o.locale);
      this.scene.setOptions(this.sceneOptions());
    }
    if (restart) {
      this.stop();
      this.start();
    } else if (o.mode === "design" || !this.runtime.continuous) {
      this.refresh();
    }
  }

  /** Page and element visibility and HUD activation together; hidden ends the session. */
  setShown(shown: boolean) {
    if (this.disposed || shown === this.shown) return;
    this.shown = shown;
    if (shown) this.start();
    else this.stop();
  }

  get sessionActive() {
    return this.session !== undefined;
  }

  dispose() {
    this.stop();
    this.disposed = true;
  }

  private sceneOptions() {
    const o = this.options;
    return { locale: o.locale, pxPerUnit: o.pxPerUnit ?? 1, idPrefix: o.idPrefix ?? "ovl-", assets: o.assets ?? NO_ASSETS };
  }

  private compile() {
    const o = this.options;
    const provider = isProvider(o.source) ? o.source : undefined;
    this.runtime = createRuntime(o.config, {
      locale: o.locale,
      channels: provider ? (name) => provider.metadata(name) : undefined,
    });
    this.scene = new SceneBuilder(o.config, this.sceneOptions(), this.runtime.staticElements());
  }

  private start() {
    if (this.session || !this.shown || this.disposed) return;
    const o = this.options;
    if (o.mode === "design") {
      this.render(this.runtime.baseFrame(o.scrub));
      return;
    }
    let source: RuntimeSource = (o.source as RuntimeSource | undefined) ?? NULL_SOURCE;
    let requirement: Requirement | undefined;
    if (isProvider(o.source)) {
      const staleAfterMs: Record<string, number | undefined> = {};
      for (const [name, s] of Object.entries(o.config.sources?.telemetry ?? {})) staleAfterMs[name] = s.staleAfterMs;
      requirement = o.source.require(this.consumerId, this.runtime.dependencies(), { staleAfterMs });
      source = requirement.source;
    }
    this.runtime.reset(o.clock.now());
    const session: NonNullable<OverlayController["session"]> = { source, requirement };
    this.session = session;
    if (this.runtime.continuous) session.stopFrames = o.clock.onFrame((t) => this.frame(t));
    else this.requestFrame();
    if (subscribable(o.source)) {
      session.unsubscribe = o.source.subscribe(() => {
        // Channel metadata may arrive later: formulas are re-typed, the session keeps running.
        if (isProvider(o.source)) this.runtime.refreshChannels();
        if (!this.runtime.continuous) this.requestFrame();
      });
    }
  }

  private stop() {
    const s = this.session;
    this.session = undefined;
    this.pendingFrame?.();
    this.pendingFrame = undefined;
    if (!s) return;
    s.stopFrames?.();
    s.unsubscribe?.();
    s.requirement?.release();
  }

  /** Event-driven HUDs (no time effects) render one frame per source change. */
  private requestFrame() {
    if (this.pendingFrame) return;
    this.pendingFrame = this.options.clock.onFrame((t) => {
      this.pendingFrame?.();
      this.pendingFrame = undefined;
      this.frame(t);
    });
  }

  private refresh() {
    if (this.options.mode === "design") {
      if (this.shown) this.render(this.runtime.baseFrame(this.options.scrub));
    } else if (this.session) {
      this.requestFrame();
    }
  }

  private frame(t: number) {
    const s = this.session;
    if (!s) return;
    let frame: FrameResult;
    try {
      frame = this.runtime.step(t, s.source);
    } catch (e) {
      // A broken frame keeps the last picture; video and control are unaffected.
      this.report([{ code: "OVL_RUNTIME_ERROR", severity: "error", location: {}, message: String(e instanceof Error ? e.message : e) }]);
      return;
    }
    this.render(frame);
  }

  private render(frame: FrameResult) {
    let diagnostics = frame.diagnostics;
    try {
      const scene = this.scene.build(frame);
      diagnostics = [...diagnostics, ...scene.diagnostics];
      if (!this.vnode || !this.dom) {
        this.dom = create(this.doc, scene.tree);
        this.host.appendChild(this.dom);
      } else {
        this.dom = patch(this.doc, this.host, this.dom, this.vnode, scene.tree);
      }
      this.vnode = scene.tree;
    } catch (e) {
      diagnostics = [...diagnostics, { code: "OVL_RUNTIME_ERROR", severity: "error", location: {}, message: String(e instanceof Error ? e.message : e) }];
    }
    this.report(diagnostics);
    this.options.onFrame?.(frame);
  }

  private report(diagnostics: RuntimeDiagnostic[]) {
    const key = JSON.stringify(diagnostics);
    if (key === this.lastDiagnostics) return;
    this.lastDiagnostics = key;
    this.options.onDiagnostics?.(diagnostics);
  }
}
