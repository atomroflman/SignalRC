// AP12 – the starting templates (Overlay-Feature.md "Startvorlagen"): compass,
// pitch/roll, track run, distance warning and LiDAR grid with optional sweep.
// Built only from catalog elements; every dynamic value comes from a mapped
// channel. Static base values are the neutral design positions.
import type { Clip, OverlayElement, PropertyValue } from "../document/types";
import { formatNumber } from "./conversions";
import { ANGLE_PRESETS, DISTANCE_PRESETS, SPEED_PRESETS } from "./conversions";
import type { BuildContext, TemplateContent, TemplateDefinition } from "./types";

const bind = (expr: string, base: PropertyValue = 0, smoothing?: number): PropertyValue =>
  ({ base: base as never, binding: { expr, ...(smoothing ? { smoothing: { timeConstantS: smoothing } } : {}) } });

const group = (name: string, children: string[], props: Record<string, PropertyValue>): OverlayElement =>
  ({ type: "group", name, children, props });

// --- Compass ---

const compass: TemplateDefinition = {
  id: "compass",
  name: { de: "Kompass", en: "Compass" },
  description: {
    de: "Kompassrose, die sich mit dem Kurs dreht, mit fester Markierung und Gradanzeige.",
    en: "Compass rose turning with the heading, with fixed lubber line and degree readout.",
  },
  slots: [{ id: "heading", label: { de: "Kurs (Grad, 0 = Norden)", en: "Heading (degrees, 0 = north)" }, kind: "number", unit: "°", presets: ANGLE_PRESETS }],
  params: [],
  size: { width: 220, height: 250 },
  build(ctx: BuildContext): TemplateContent {
    const h = ctx.ref("heading");
    const de = ctx.locale === "de";
    const elements: Record<string, OverlayElement> = {
      ring: { type: "ellipse", name: de ? "Ring" : "Ring", props: { width: 200, height: 200, fill: "#00000066", stroke: "#ffffff", strokeWidth: 2 } },
    };
    const rose = ["ring"];
    for (let i = 0; i < 8; i++) {
      const id = `tick${i}`;
      elements[id] = {
        type: "line", name: `${de ? "Strich" : "Tick"} ${i * 45}°`,
        props: { x: 100, y: 0, x2: 0, y2: i % 2 === 0 ? 16 : 10, stroke: "#ffffff", strokeWidth: 2, rotation: i * 45, pivotX: 0, pivotY: 100 },
      };
      rose.push(id);
    }
    const labels: [string, string, number, number, string][] = [
      ["n", "N", 100, 40, "#ff5050"],
      ["e", de ? "O" : "E", 168, 108, "#ffffff"],
      ["s", "S", 100, 176, "#ffffff"],
      ["w", "W", 32, 108, "#ffffff"],
    ];
    for (const [id, text, x, y, fill] of labels) {
      elements[id] = { type: "text", name: text, props: { x, y, text, fontSize: 22, fontWeight: "bold", align: "middle", fill } };
      rose.push(id);
    }
    elements.rose = group(de ? "Rose" : "Rose", rose, { x: 10, y: 10, pivotX: 100, pivotY: 100, rotation: bind(`-${h}`, 0, 0.15) });
    elements.lubber = { type: "line", name: de ? "Markierung" : "Lubber line", props: { x: 110, y: 2, x2: 0, y2: 22, stroke: "#ffcc00", strokeWidth: 4, lineCap: "round" } };
    elements.readout = {
      type: "valueText", name: de ? "Kurs" : "Heading",
      props: { x: 110, y: 244, value: bind(h, null), decimals: 0, unit: "°", align: "middle", fontSize: 24 },
    };
    elements.root = group(de ? "Kompass" : "Compass", ["rose", "lubber", "readout"], { pivotX: 110, pivotY: 125 });
    return { elements, root: "root" };
  },
};

// --- Pitch / roll ---

const attitude: TemplateDefinition = {
  id: "attitude",
  name: { de: "Pitch/Roll-Lage", en: "Pitch/roll attitude" },
  description: {
    de: "Künstlicher Horizont: Roll dreht, Pitch verschiebt die Horizontlinie; feste Fahrzeugmarke.",
    en: "Artificial horizon: roll rotates and pitch shifts the horizon line; fixed vehicle mark.",
  },
  slots: [
    { id: "pitch", label: { de: "Pitch (Grad, Nase hoch positiv)", en: "Pitch (degrees, nose up positive)" }, kind: "number", unit: "°", presets: ANGLE_PRESETS },
    { id: "roll", label: { de: "Roll (Grad, rechts positiv)", en: "Roll (degrees, right positive)" }, kind: "number", unit: "°", presets: ANGLE_PRESETS },
  ],
  params: [{ id: "pxPerDeg", label: { de: "Pixel je Grad Pitch", en: "Pixels per degree pitch" }, type: "number", default: 3, min: 0.5, max: 10 }],
  size: { width: 240, height: 270 },
  build(ctx) {
    const de = ctx.locale === "de";
    const k = ctx.param<number>("pxPerDeg");
    const elements: Record<string, OverlayElement> = {
      frame: { type: "ellipse", name: de ? "Rahmen" : "Frame", props: { width: 240, height: 240, fill: "#0b1a2a99", stroke: "#ffffff", strokeWidth: 2 } },
      horizonLine: { type: "line", name: de ? "Horizont" : "Horizon", props: { x: 10, y: 120, x2: 220, y2: 0, stroke: "#ffffff", strokeWidth: 3 } },
    };
    const ladder = ["horizonLine"];
    for (const deg of [-20, -10, 10, 20]) {
      const id = `ladder${deg < 0 ? "m" : "p"}${Math.abs(deg)}`;
      const w = Math.abs(deg) === 10 ? 60 : 90;
      elements[id] = { type: "line", name: `${deg}°`, props: { x: 120 - w / 2, y: 120 - deg * k, x2: w, y2: 0, stroke: "#ffffffaa", strokeWidth: 2 } };
      ladder.push(id);
    }
    elements.pitchLadder = group(de ? "Pitch-Leiter" : "Pitch ladder", ladder, { pivotX: 120, pivotY: 120, y: bind(`${ctx.ref("pitch")} * ${formatNumber(k)}`, 0) });
    elements.horizon = group(de ? "Horizont (Roll)" : "Horizon (roll)", ["pitchLadder"], { pivotX: 120, pivotY: 120, rotation: bind(`-${ctx.ref("roll")}`, 0, 0.1) });
    const mark = { stroke: "#ffcc00", strokeWidth: 4, lineCap: "round" } as const;
    elements.wingLeft = { type: "line", name: de ? "Marke links" : "Mark left", props: { x: 66, y: 120, x2: 38, y2: 0, ...mark } };
    elements.wingRight = { type: "line", name: de ? "Marke rechts" : "Mark right", props: { x: 136, y: 120, x2: 38, y2: 0, ...mark } };
    elements.center = { type: "ellipse", name: de ? "Mitte" : "Center", props: { x: 115, y: 115, width: 10, height: 10, fill: "#ffcc00" } };
    elements.rollPointer = { type: "line", name: de ? "Roll-Zeiger" : "Roll pointer", props: { x: 120, y: 2, x2: 0, y2: 14, ...mark } };
    const readout = (prefix: string, slot: string, x: number): OverlayElement => ({
      type: "valueText", name: prefix, props: { x, y: 264, prefix: `${prefix} `, value: bind(ctx.ref(slot), null), decimals: 0, unit: "°", align: "middle", fontSize: 18 },
    });
    elements.pitchText = readout("P", "pitch", 60);
    elements.rollText = readout("R", "roll", 180);
    elements.root = group(de ? "Lage" : "Attitude",
      ["frame", "horizon", "wingLeft", "wingRight", "center", "rollPointer", "pitchText", "rollText"], { pivotX: 120, pivotY: 135 });
    return { elements, root: "root" };
  },
};

// --- Track run ---

const LINK_SPACING = 20;

const trackRun: TemplateDefinition = {
  id: "trackRun",
  name: { de: "Kettenlauf", en: "Track run" },
  description: {
    de: "Zwei Ketten, deren Glieder mit der gemessenen Geschwindigkeit laufen (Bewegungsrate).",
    en: "Two tracks whose links move with the measured speed (rate).",
  },
  slots: [
    { id: "left", label: { de: "Geschwindigkeit links (m/s)", en: "Speed left (m/s)" }, kind: "number", unit: "m/s", presets: SPEED_PRESETS },
    { id: "right", label: { de: "Geschwindigkeit rechts (m/s)", en: "Speed right (m/s)" }, kind: "number", unit: "m/s", presets: SPEED_PRESETS },
  ],
  params: [{ id: "pxPerMeter", label: { de: "Pixel je Meter", en: "Pixels per meter" }, type: "number", default: 60, min: 1, max: 1000 }],
  size: { width: 200, height: 290 },
  build(ctx) {
    const de = ctx.locale === "de";
    const k = ctx.param<number>("pxPerMeter");
    const elements: Record<string, OverlayElement> = {};
    const children: string[] = [];
    for (const [side, x, label] of [["left", 20, de ? "L" : "L"], ["right", 140, de ? "R" : "R"]] as const) {
      const links: string[] = [];
      for (let i = 0; i < 12; i++) {
        const id = `${side}Link${i}`;
        elements[id] = { type: "rect", name: `${de ? "Glied" : "Link"} ${i + 1}`, props: { x: 4, y: i * LINK_SPACING + 6, width: 32, height: 8, cornerRadius: 2, fill: "#d0d0d0" } };
        links.push(id);
      }
      elements[`${side}Frame`] = {
        type: "rect", name: de ? `Kette ${label}` : `Track ${label}`,
        props: { x, y: 0, width: 40, height: 250, cornerRadius: 6, fill: "#00000055", stroke: "#ffffff", strokeWidth: 2 },
      };
      elements[`${side}Links`] = group(de ? `Glieder ${label}` : `Links ${label}`, links, {
        x,
        y: { base: 0, rate: { expr: `${ctx.ref(side)} * ${formatNumber(k)}`, wrap: { min: 0, max: LINK_SPACING } } },
        pivotX: 20,
        pivotY: 125,
      });
      elements[`${side}Speed`] = {
        type: "valueText", name: de ? `Geschwindigkeit ${label}` : `Speed ${label}`,
        props: { x: x + 20, y: 280, value: bind(ctx.ref(side), null), decimals: 1, unit: "m/s", align: "middle", fontSize: 16 },
      };
      children.push(`${side}Frame`, `${side}Links`, `${side}Speed`);
    }
    elements.root = group(de ? "Kettenlauf" : "Track run", children, { pivotX: 100, pivotY: 145 });
    return { elements, root: "root" };
  },
};

// --- Distance warning ---

const distance: TemplateDefinition = {
  id: "distanceWarning",
  name: { de: "Abstandswarnung", en: "Distance warning" },
  description: {
    de: "Abstandsbalken mit Farbwechsel; unter der Warnschwelle erscheint ein Hinweis, unter der kritischen Schwelle blinkt er.",
    en: "Distance bar with color change; below the warning threshold a notice appears, below the critical threshold it blinks.",
  },
  slots: [{ id: "distance", label: { de: "Abstand (m)", en: "Distance (m)" }, kind: "number", unit: "m", presets: DISTANCE_PRESETS }],
  params: [
    { id: "warnM", label: { de: "Warnschwelle (m)", en: "Warning threshold (m)" }, type: "number", default: 1, min: 0 },
    { id: "criticalM", label: { de: "Kritische Schwelle (m)", en: "Critical threshold (m)" }, type: "number", default: 0.4, min: 0 },
    { id: "maxM", label: { de: "Skalenende (m)", en: "Scale end (m)" }, type: "number", default: 4, min: 0.1 },
  ],
  size: { width: 260, height: 110 },
  build(ctx) {
    const de = ctx.locale === "de";
    const d = ctx.ref("distance");
    const warn = formatNumber(ctx.param<number>("warnM"));
    const crit = formatNumber(ctx.param<number>("criticalM"));
    const color = `if(${d} < ${crit}, "#ff3b30", if(${d} < ${warn}, "#ffb000", "#30d158"))`;
    const elements: Record<string, OverlayElement> = {
      background: { type: "rect", name: de ? "Hintergrund" : "Background", props: { width: 260, height: 110, cornerRadius: 8, fill: "#00000066" } },
      label: { type: "text", name: de ? "Beschriftung" : "Label", props: { x: 12, y: 26, text: de ? "Abstand" : "Distance", fontSize: 16, fill: "#ffffffcc" } },
      value: { type: "valueText", name: de ? "Abstand" : "Distance", props: { x: 248, y: 28, value: bind(d, null), decimals: 2, unit: "m", align: "end", fontSize: 22 } },
      bar: {
        type: "linearGauge", name: de ? "Balken" : "Bar",
        props: { x: 12, y: 42, width: 236, height: 18, value: bind(d, 0), min: 0, max: ctx.param<number>("maxM"), barColor: bind(color, "#30d158"), trackColor: "#ffffff22" },
      },
      warning: {
        type: "text", name: de ? "Warnung" : "Warning",
        props: {
          x: 130, y: 98, fontSize: 22, fontWeight: "bold", align: "middle", fill: bind(color, "#ffb000"),
          text: bind(`if(${d} < ${crit}, ${de ? '"STOPP"' : '"STOP"'}, ${de ? '"ACHTUNG"' : '"CAUTION"'})`, de ? "ACHTUNG" : "CAUTION"),
          visible: bind(`${d} < ${warn}`, false),
        },
      },
    };
    elements.root = group(de ? "Abstandswarnung" : "Distance warning", ["background", "label", "value", "bar", "warning"], { pivotX: 130, pivotY: 55 });
    const blink: Clip = {
      name: de ? "Blinken kritisch" : "Blink critical",
      durationS: 0.6,
      repeat: "infinite",
      trigger: { mode: "whileTrue", condition: `${d} < ${crit}`, onDeactivate: "stop" },
      endState: "base",
      tracks: [{ element: "warning", property: "opacity", keyframes: [{ t: 0, value: 1 }, { t: 0.3, value: 0.25 }, { t: 0.6, value: 1 }] }],
    };
    return { elements, root: "root", clips: { blink } };
  },
};

// --- LiDAR grid ---

const lidar: TemplateDefinition = {
  id: "lidarGrid",
  name: { de: "LiDAR-Raster", en: "LiDAR grid" },
  description: {
    de: "LiDAR-Widget für einen Rasterkanal; optional mit Sweep-Effekt. Der Kanal muss in der Kanalverwaltung eingerichtet sein.",
    en: "LiDAR widget for a grid channel; optional sweep effect. The channel must be set up in the channel settings.",
  },
  slots: [{ id: "grid", label: { de: "LiDAR-Rasterkanal", en: "LiDAR grid channel" }, kind: "lidarGrid" }],
  params: [
    { id: "radius", label: { de: "Radius (px)", en: "Radius (px)" }, type: "number", default: 120, min: 20, max: 1000 },
    { id: "sectors", label: { de: "Sektoren", en: "Sectors" }, type: "choice", default: 8, values: [4, 6, 8, 12, 16, 24] },
    { id: "sweep", label: { de: "Sweep-Effekt", en: "Sweep effect" }, type: "bool", default: false },
  ],
  size: { width: 240, height: 240 },
  build(ctx) {
    const de = ctx.locale === "de";
    const r = ctx.param<number>("radius");
    const elements: Record<string, OverlayElement> = {
      widget: {
        type: "lidarWidget", name: "LiDAR", source: ctx.channel("grid"),
        props: { radius: r, sectors: ctx.param<number>("sectors"), sweepEnabled: ctx.param<boolean>("sweep") },
      },
    };
    elements.root = group(de ? "LiDAR-Raster" : "LiDAR grid", ["widget"], { pivotX: r, pivotY: r });
    return { elements, root: "root" };
  },
};

export const TEMPLATES: readonly TemplateDefinition[] = [compass, attitude, trackRun, distance, lidar];

export function templateById(id: string): TemplateDefinition | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
