// Scene: effective configuration + frame values → SVG tree (Shared/Overlay/README.md
// §3, §4; runtime/README.md §3 markers; svg/README.md §5 assets).
import type { EffectiveConfig, EffectiveElement, Interaction } from "../document/types";
import { formatDecimal, localized, type TextValue } from "../expression";
import {
  apply, arcPath, elementMatrix, IDENTITY, matrixAttr, multiply, polar, transformBox, unionBox, type Box, type Mat,
} from "./geometry";
import { AssetParseError, parseAsset, partsBelow, recolor, scopeIds, withParts, type ParsedAsset } from "./svg-asset";
import type { ElementFrame, FrameResult, Locale, Marker, RuntimeAsset, RuntimeDiagnostic } from "./types";
import { h, num, type VNode } from "./vnode";
import { lidarScene } from "./widgets/lidar/lidar-scene";

export interface SceneOptions {
  locale: Locale;
  /** Screen pixels per workspace unit; markers keep 16 CSS px. */
  pxPerUnit: number;
  /** Prefix of scoped asset ids, `ovl-` by contract. */
  idPrefix: string;
  assets: Record<string, RuntimeAsset>;
}

export interface Scene {
  tree: VNode;
  diagnostics: RuntimeDiagnostic[];
}

export const MARKER_SIZE_PX = 16;
const NO_VALUE = "—";

const n = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const color = (v: unknown) => (typeof v === "string" ? v : "none");
const fraction = (v: number, min: number, max: number) => (max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0);

function fontAttrs(p: Record<string, unknown>) {
  const family = String(p.fontFamily ?? "sans-serif");
  const stroke = color(p.stroke);
  const sw = n(p.strokeWidth);
  return {
    "font-family": family === "condensed" ? "sans-serif" : family,
    "font-stretch": family === "condensed" ? "condensed" : undefined,
    "font-size": n(p.fontSize, 24),
    "font-weight": p.fontWeight === "bold" ? "bold" : undefined,
    "text-anchor": p.align === "middle" ? "middle" : p.align === "end" ? "end" : undefined,
    fill: color(p.fill),
    stroke: stroke !== "none" && sw > 0 ? stroke : undefined,
    "stroke-width": stroke !== "none" && sw > 0 ? sw : undefined,
  };
}

/** valueText display: number per decimals and locale (D48), "—" without a usable value. */
export function formatValueText(p: Record<string, unknown>, noValue: boolean, locale: Locale): string {
  const prefix = typeof p.prefix === "string" ? p.prefix : "";
  const unit = typeof p.unit === "string" ? p.unit : "";
  let body = NO_VALUE;
  const v = p.value;
  if (!noValue) {
    if (typeof v === "number") {
      const decimals = typeof p.decimals === "number" ? p.decimals : undefined;
      let text = formatDecimal(v, decimals ?? 2);
      if (decimals === undefined && text.includes(".")) text = text.replace(/\.?0+$/, "");
      body = locale === "de" ? text.replace(".", ",") : text;
    } else if (typeof v === "boolean") {
      body = locale === "de" ? (v ? "wahr" : "falsch") : v ? "true" : "false";
    } else if (Array.isArray(v)) {
      body = localized(v as TextValue, locale);
    } else if (typeof v === "string") {
      body = v;
    }
  }
  return prefix + body + (unit ? (unit.startsWith("°") ? unit : ` ${unit}`) : "");
}

function textBox(p: Record<string, unknown>, text: string): Box {
  const fs = n(p.fontSize, 24);
  const w = 0.6 * fs * [...text].length;
  const x0 = p.align === "middle" ? -w / 2 : p.align === "end" ? -w : 0;
  return [x0, -0.8 * fs, w, fs];
}

function markerSymbol(kind: Marker): VNode[] {
  switch (kind) {
    case "invalid":
      return [h("circle", { r: 7, fill: "#606060", stroke: "#ffffff", "stroke-width": 1 }), h("line", { x1: -4, y1: 4, x2: 4, y2: -4, stroke: "#ffffff", "stroke-width": 2 })];
    case "unchecked":
      return [
        h("path", { d: "M0 -7L7.5 6L-7.5 6Z", fill: "#ffcc00", stroke: "#000000", "stroke-width": 1, "stroke-linejoin": "round" }),
        h("line", { x1: 0, y1: -3, x2: 0, y2: 1.5, stroke: "#000000", "stroke-width": 1.8 }),
        h("circle", { cy: 3.8, r: 0.9, fill: "#000000" }),
      ];
    case "paused":
      return [h("circle", { r: 7, fill: "#606060" }), h("rect", { x: -3, y: -4, width: 2, height: 8, fill: "#ffffff" }), h("rect", { x: 1, y: -4, width: 2, height: 8, fill: "#ffffff" })];
  }
}

interface AssetInstance {
  assetId: string;
  parsed: ParsedAsset;
  children: (VNode | string)[];
  below: WeakMap<VNode, Set<string>>;
}

const parsedCache = new Map<string, ParsedAsset | AssetParseError>();

function parsed(svg: string): ParsedAsset | AssetParseError {
  let p = parsedCache.get(svg);
  if (!p) {
    try {
      p = parseAsset(svg);
    } catch (e) {
      p = e instanceof AssetParseError ? e : new AssetParseError(String(e));
    }
    if (parsedCache.size > 32) parsedCache.clear();
    parsedCache.set(svg, p);
  }
  return p;
}

export class SceneBuilder {
  private readonly staticCache = new Map<string, VNode>();
  private readonly lastGood = new Map<string, VNode>();
  private readonly assetInstances = new Map<string, AssetInstance>();
  private diagnostics: RuntimeDiagnostic[] = [];
  private markers: VNode[] = [];
  private frame!: FrameResult;

  constructor(
    private readonly config: EffectiveConfig,
    private options: SceneOptions,
    /** Elements whose output never changes (runtime.staticElements()). */
    private readonly staticIds: ReadonlySet<string> = new Set(),
  ) {}

  setOptions(options: Partial<SceneOptions>) {
    const before = this.options;
    this.options = { ...this.options, ...options };
    if (before.locale !== this.options.locale || before.assets !== this.options.assets || before.idPrefix !== this.options.idPrefix) {
      this.staticCache.clear();
      this.assetInstances.clear();
    }
  }

  build(frame: FrameResult): Scene {
    this.frame = frame;
    this.diagnostics = [];
    this.markers = [];
    const rt = this.config.rootTransform;
    const root: Mat = rt ? [rt.scale, 0, 0, rt.scale, rt.offsetX, rt.offsetY] : IDENTITY;
    const children = this.config.root.map((id) => this.element(id, root, true)).filter((c): c is VNode => !!c);
    const tree = h("g", {}, [
      h("g", { "data-ovl-root": "", transform: matrixAttr(root) }, children),
      h("g", { "data-ovl-markers": "" }, this.markers),
    ]);
    return { tree, diagnostics: this.diagnostics };
  }

  private element(id: string, parent: Mat, shown: boolean): VNode | undefined {
    const el = this.config.elements[id];
    const f = this.frame.elements[id];
    if (!el || !f) return this.lastGood.get(id);
    try {
      const node = this.renderElement(el, f, parent, shown);
      this.lastGood.set(id, node);
      return node;
    } catch (e) {
      this.diagnostics.push({ code: "OVL_RUNTIME_ELEMENT_ERROR", severity: "warning", location: { element: id }, message: String(e instanceof Error ? e.message : e) });
      return this.lastGood.get(id);
    }
  }

  private renderElement(el: EffectiveElement, f: ElementFrame, parent: Mat, parentShown: boolean): VNode {
    const p = f.props;
    let marker = f.marker;
    let content: (VNode | string)[] | undefined;
    if (el.type === "svgAsset") {
      const r = this.asset(el, f);
      if (!r.ok) marker = "invalid";
      else content = r.content;
    }
    const box = this.localBox(el, f);
    const px = p.pivotX === "center" || p.pivotX === undefined ? box[0] + box[2] / 2 : n(p.pivotX);
    const py = p.pivotY === "center" || p.pivotY === undefined ? box[1] + box[3] / 2 : n(p.pivotY);
    const local = elementMatrix(n(p.x), n(p.y), n(p.rotation), n(p.scaleX, 1), n(p.scaleY, 1), px, py);
    const world = multiply(parent, local);
    const visible = p.visible !== false && !(el.onInvalid === "hide" && marker === "invalid");
    const shown = parentShown && visible;
    if (marker && shown) {
      const [x, y] = apply(world, box[0] + box[2], box[1]);
      const s = 1 / Math.max(1e-6, this.options.pxPerUnit);
      this.markers.push(h("g", { "data-ovl-marker": marker, "data-ovl-for": el.id, transform: `translate(${num(x)} ${num(y)}) scale(${num(s)})` }, markerSymbol(marker)));
    }
    let children: (VNode | string)[];
    if (el.type === "group") {
      children = (el.children ?? []).map((c) => this.element(c, world, shown)).filter((c): c is VNode => !!c);
    } else if (content) {
      children = content;
    } else {
      const cached = this.staticIds.has(el.id) ? this.staticCache.get(el.id) : undefined;
      if (cached) children = cached.children;
      else {
        children = this.content(el, f);
        if (this.staticIds.has(el.id)) this.staticCache.set(el.id, h("g", {}, children));
      }
    }
    const opacity = n(p.opacity, 1) * (marker === "invalid" ? 0.4 : 1);
    return h("g", {
      "data-ovl-id": el.id,
      ...interactionAttrs(el.interaction),
      transform: matrixAttr(local),
      opacity: opacity < 1 ? opacity : undefined,
      display: visible ? undefined : "none",
    }, children);
  }

  /** Local box of an element: pivot "center" and marker corner (Shared/Overlay/README.md §3). */
  private localBox(el: EffectiveElement, f: ElementFrame): Box {
    const p = f.props;
    switch (el.type) {
      case "rect": case "ellipse": case "linearGauge":
        return [0, 0, n(p.width), n(p.height)];
      case "line": {
        const x2 = n(p.x2);
        const y2 = n(p.y2);
        return [Math.min(0, x2), Math.min(0, y2), Math.abs(x2), Math.abs(y2)];
      }
      case "arc": case "radialGauge": case "lidarWidget":
        return [0, 0, 2 * n(p.radius), 2 * n(p.radius)];
      case "text":
        return textBox(p, String(p.text ?? ""));
      case "valueText":
        return textBox(p, formatValueText(p, f.noValue ?? false, this.options.locale));
      case "svgAsset": {
        const a = el.assetId ? this.options.assets[el.assetId] : undefined;
        const meta = a?.metadata;
        if (meta) return [0, 0, meta.width, meta.height];
        const pa = a ? parsed(a.svg) : undefined;
        return pa && !(pa instanceof AssetParseError) ? [0, 0, pa.viewBox[2], pa.viewBox[3]] : [0, 0, 0, 0];
      }
      case "group": {
        let box: Box | undefined;
        for (const c of el.children ?? []) {
          const ce = this.config.elements[c];
          const cf = this.frame.elements[c];
          if (!ce || !cf) continue;
          const cb = this.localBox(ce, cf);
          const cp = cf.props;
          const px = cp.pivotX === "center" || cp.pivotX === undefined ? cb[0] + cb[2] / 2 : n(cp.pivotX);
          const py = cp.pivotY === "center" || cp.pivotY === undefined ? cb[1] + cb[3] / 2 : n(cp.pivotY);
          box = unionBox(box, transformBox(elementMatrix(n(cp.x), n(cp.y), n(cp.rotation), n(cp.scaleX, 1), n(cp.scaleY, 1), px, py), cb));
        }
        return box ?? [0, 0, 0, 0];
      }
    }
  }

  private content(el: EffectiveElement, f: ElementFrame): (VNode | string)[] {
    const p = f.props;
    const stroke = color(p.stroke);
    const sw = n(p.strokeWidth);
    const strokeAttrs = { stroke: stroke !== "none" ? stroke : undefined, "stroke-width": stroke !== "none" ? sw : undefined };
    switch (el.type) {
      case "rect": {
        const cr = n(p.cornerRadius);
        return [h("rect", { width: n(p.width), height: n(p.height), rx: cr > 0 ? cr : undefined, fill: color(p.fill), ...strokeAttrs })];
      }
      case "ellipse": {
        const w = n(p.width);
        const ht = n(p.height);
        return [h("ellipse", { cx: w / 2, cy: ht / 2, rx: w / 2, ry: ht / 2, fill: color(p.fill), ...strokeAttrs })];
      }
      case "line":
        return [h("line", { x1: 0, y1: 0, x2: n(p.x2), y2: n(p.y2), stroke: color(p.stroke), "stroke-width": sw, "stroke-linecap": p.lineCap !== "butt" ? String(p.lineCap) : undefined })];
      case "arc": {
        const r = n(p.radius);
        return [h("path", { d: arcPath(r, r, r, n(p.startAngle), n(p.endAngle)), fill: "none", stroke: color(p.stroke), "stroke-width": sw, "stroke-linecap": p.lineCap !== "butt" ? String(p.lineCap) : undefined })];
      }
      case "text":
        return [h("text", fontAttrs(p), [String(p.text ?? "")])];
      case "valueText":
        return [h("text", fontAttrs(p), [formatValueText(p, f.noValue ?? false, this.options.locale)])];
      case "linearGauge":
        return this.linearGauge(p);
      case "radialGauge":
        return this.radialGauge(p);
      case "lidarWidget":
        return f.lidar ? lidarScene({
          radius: n(p.radius),
          showLabels: p.showLabels !== false,
          labelColor: color(p.labelColor),
          sweepEnabled: p.sweepEnabled === true,
          sweepColor: color(p.sweepColor),
          idleColor: color(p.idleColor),
          contourWidth: n(p.contourWidth),
          contourShadow: p.contourShadow !== false,
          contourShadowOpacity: n(p.contourShadowOpacity),
        }, f.lidar, this.options.locale) : [];
      default:
        return [];
    }
  }

  private linearGauge(p: Record<string, unknown>): VNode[] {
    const w = n(p.width);
    const ht = n(p.height);
    const u = fraction(n(p.value), n(p.min), n(p.max));
    const vertical = p.orientation === "vertical";
    const bar = vertical ? { x: 0, y: ht * (1 - u), width: w, height: ht * u } : { x: 0, y: 0, width: w * u, height: ht };
    const border = color(p.borderColor);
    const bw = n(p.borderWidth);
    const ticks = Math.max(0, Math.round(n(p.tickCount)));
    const tickColor = border !== "none" ? border : "#ffffff";
    const out = [h("rect", { width: w, height: ht, fill: color(p.trackColor) }), h("rect", { ...bar, fill: color(p.barColor) })];
    if (ticks > 0) {
      out.push(h("g", { stroke: tickColor, "stroke-width": 1 }, Array.from({ length: ticks }, (_, i) => {
        const at = ticks === 1 ? 0.5 : i / (ticks - 1);
        return vertical ? h("line", { x1: 0, x2: w, y1: ht * (1 - at), y2: ht * (1 - at) }) : h("line", { x1: w * at, x2: w * at, y1: 0, y2: ht });
      })));
    }
    if (border !== "none" && bw > 0) out.push(h("rect", { width: w, height: ht, fill: "none", stroke: border, "stroke-width": bw }));
    return out;
  }

  private radialGauge(p: Record<string, unknown>): VNode[] {
    const r = n(p.radius);
    const sw = n(p.strokeWidth);
    const start = n(p.startAngle);
    const end = n(p.endAngle);
    const u = fraction(n(p.value), n(p.min), n(p.max));
    const rr = Math.max(0, r - sw / 2);
    const valueAngle = start + (end - start) * u;
    const out = [
      h("path", { d: arcPath(r, r, rr, start, end), fill: "none", stroke: color(p.trackColor), "stroke-width": sw }),
      h("path", { d: u > 0 ? arcPath(r, r, rr, start, valueAngle) : "", fill: "none", stroke: color(p.barColor), "stroke-width": sw }),
    ];
    const ticks = Math.max(0, Math.round(n(p.tickCount)));
    if (ticks > 0) {
      out.push(h("g", { stroke: "#ffffff", "stroke-width": 1 }, Array.from({ length: ticks }, (_, i) => {
        const a = start + (end - start) * (ticks === 1 ? 0.5 : i / (ticks - 1));
        const [x1, y1] = polar(r, r, Math.max(0, r - sw - 2), a);
        const [x2, y2] = polar(r, r, Math.max(0, r - sw - 2 - r * 0.12), a);
        return h("line", { x1, y1, x2, y2 });
      })));
    }
    if (p.needle === true) {
      const [x, y] = polar(r, r, rr, valueAngle);
      out.push(h("line", { x1: r, y1: r, x2: x, y2: y, stroke: color(p.needleColor), "stroke-width": Math.max(1, r / 30), "stroke-linecap": "round" }));
      out.push(h("circle", { cx: r, cy: r, r: Math.max(1.5, r / 15), fill: color(p.needleColor) }));
    }
    return out;
  }

  private asset(el: EffectiveElement, f: ElementFrame): { ok: true; content: (VNode | string)[] } | { ok: false } {
    const fail = (code: string, message: string) => {
      this.diagnostics.push({ code, severity: "warning", location: { element: el.id, field: "assetId" }, message });
      return { ok: false as const };
    };
    const a = el.assetId ? this.options.assets[el.assetId] : undefined;
    if (!a) return fail("OVL_REF_UNKNOWN_ASSET", "Asset nicht vorhanden");
    let inst = this.assetInstances.get(el.id);
    if (!inst || inst.assetId !== el.assetId) {
      const pa = parsed(a.svg);
      if (pa instanceof AssetParseError) return fail("OVL_RUNTIME_ASSET_INVALID", pa.message);
      const children = scopeIds(pa.children, `${this.options.idPrefix}${el.id}-`);
      const [vx, vy] = pa.viewBox;
      const content = vx !== 0 || vy !== 0 ? [h("g", { transform: `translate(${num(-vx)} ${num(-vy)})` }, children)] : children;
      inst = { assetId: el.assetId!, parsed: pa, children: content, below: partsBelow(content) };
      this.assetInstances.set(el.id, inst);
    }
    // A colour for the whole asset, e.g. a beacon icon that blinks (svg §5).
    const fill = assetColor(f.props.fill);
    const stroke = assetColor(f.props.stroke);
    const ids = Object.keys(f.parts);
    if (ids.length === 0) {
      return { ok: true, content: fill || stroke ? [h("g", { fill }, recolor(inst.children, fill, stroke))] : inst.children };
    }
    const bboxes = a.metadata?.parts ?? {};
    // Parts with their own colour keep it when the whole asset is recoloured.
    const ownColor = new Set<VNode>();
    const content = withParts(inst.children, inst.below, new Set(ids), (partId, node, children) => {
      const pp = f.parts[partId].props;
      const bb = bboxes[partId]?.bbox;
      const px = pp.pivotX === "center" ? (bb ? bb[0] + bb[2] / 2 : 0) : n(pp.pivotX);
      const py = pp.pivotY === "center" ? (bb ? bb[1] + bb[3] / 2 : 0) : n(pp.pivotY);
      const m = elementMatrix(n(pp.x), n(pp.y), n(pp.rotation), n(pp.scaleX, 1), n(pp.scaleY, 1), px, py);
      const attrs = { ...node.attrs };
      const partFill = assetColor(pp.fill);
      const partStroke = assetColor(pp.stroke);
      if (partFill) attrs.fill = partFill;
      if (partStroke) attrs.stroke = partStroke;
      if (typeof pp.strokeWidth === "number") attrs["stroke-width"] = num(pp.strokeWidth);
      // The colour reaches the whole part, also shapes inside a group part that carry their own.
      const inner = partFill || partStroke ? recolor(children, partFill, partStroke) : children;
      const opacity = n(pp.opacity, 1);
      const wrapped = h("g", {
        "data-ovl-part": partId,
        ...interactionAttrs(el.parts[partId]?.interaction),
        transform: matrixAttr(m),
        opacity: opacity < 1 ? opacity : undefined,
        display: pp.visible === false ? "none" : undefined,
      }, [{ tag: node.tag, attrs, children: inner }]);
      if (partFill || partStroke) ownColor.add(wrapped);
      return wrapped;
    });
    if (!fill && !stroke) return { ok: true, content };
    return { ok: true, content: [h("g", { fill }, recolor(content, fill, stroke, ownColor))] };
  }
}

/**
 * Clickable element or part (D75): the interaction travels in the DOM so a
 * pointer handler needs no config lookup (integration/hud-interaction.ts).
 * Pointer events stay off unless the host enables them (globals.css).
 */
function interactionAttrs(i: Interaction | undefined): Record<string, string | undefined> {
  if (!i) return {};
  return { "data-ovl-interaction": JSON.stringify(i), "data-ovl-public": i.public ? "" : undefined };
}

/** An asset colour property: a colour, or undefined for "fromAsset" (keep the asset's own colours). */
function assetColor(v: unknown): string | undefined {
  return typeof v === "string" && v !== "fromAsset" ? v : undefined;
}
