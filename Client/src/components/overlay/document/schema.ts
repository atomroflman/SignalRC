// Hand-written equivalent of Shared/Overlay/schema/overlay-document.schema.json
// (D64: no runtime schema library). schema.test.ts checks it against ajv.
// Values that are `undefined` count as absent, matching their JSON form.
import type { Diagnostic } from "./types";

type Json = unknown;
type Report = (path: string, message: string) => void;

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Name of a document signal, sig("name") (D36). */
export const SIGNAL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SIGNAL = SIGNAL_NAME;
const PROP = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const ASSET = /^sha256-[0-9a-f]{64}$/;
const SHAPES = ["rect", "ellipse", "line", "arc", "text", "valueText", "linearGauge", "radialGauge"];
const COMMON_ATTRS = ["type", "name", "disabled", "locked", "editorHidden", "lockAspect", "onInvalid", "props", "interaction"];
const INTERACTION_KINDS = ["button", "toggle", "value", "slider"];
const CLIP_KEYS = ["name", "disabled", "durationS", "repeat", "trigger", "endState", "tracks"];

/** JSON Schema string lengths count code points, not UTF-16 units. */
function length(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

const isObject = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: Json): v is number => typeof v === "number" && Number.isFinite(v);
const isInteger = (v: Json): v is number => isNumber(v) && Number.isInteger(v);
const isString = (v: Json, max: number, min = 0): v is string =>
  typeof v === "string" && length(v) >= min && length(v) <= max;

function present(o: Record<string, Json>): [string, Json][] {
  return Object.entries(o).filter(([, v]) => v !== undefined);
}

function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, "~0").replace(/\//g, "~1")}`;
}

class Checker {
  constructor(private report: Report) {}

  /** Object with known keys; reports unknown and missing keys. */
  object(v: Json, path: string, allowed: string[], required: string[] = []): v is Record<string, Json> {
    if (!isObject(v)) {
      this.report(path, "Objekt erwartet");
      return false;
    }
    let ok = true;
    for (const [k] of present(v)) {
      if (!allowed.includes(k)) {
        this.report(pointer(path, k), "unbekanntes Feld");
        ok = false;
      }
    }
    for (const k of required) {
      if (v[k] === undefined) {
        this.report(pointer(path, k), "Pflichtfeld fehlt");
        ok = false;
      }
    }
    return ok;
  }

  map(v: Json, path: string, key: (k: string) => boolean, value: (v: Json, p: string) => void): void {
    if (!isObject(v)) {
      this.report(path, "Objekt erwartet");
      return;
    }
    for (const [k, item] of present(v)) {
      const p = pointer(path, k);
      if (!key(k)) this.report(p, "ungültiger Schlüssel");
      value(item, p);
    }
  }

  opt(o: Record<string, Json>, key: string, path: string, check: (v: Json, p: string) => void): void {
    if (o[key] !== undefined) check(o[key], pointer(path, key));
  }

  expect(cond: boolean, path: string, message: string): void {
    if (!cond) this.report(path, message);
  }

  bool = (v: Json, p: string) => this.expect(typeof v === "boolean", p, "Bool erwartet");
  number = (v: Json, p: string) => this.expect(isNumber(v), p, "Zahl erwartet");
  displayName = (v: Json, p: string) => this.expect(isString(v, 100), p, "Text ≤ 100 Zeichen erwartet");
  expression = (v: Json, p: string) => this.expect(isString(v, 1000), p, "Formel ≤ 1000 Zeichen erwartet");
  id = (v: Json, p: string) => this.expect(typeof v === "string" && ID.test(v), p, "ungültige ID");

  idList = (v: Json, p: string) => {
    if (!Array.isArray(v)) return this.report(p, "Liste erwartet");
    v.forEach((item, i) => this.id(item, pointer(p, i)));
    this.expect(new Set(v).size === v.length, p, "Einträge nicht eindeutig");
  };

  range(v: Json, p: string, min: number, max: number, exclusiveMin = false, integer = false): void {
    const ok = (integer ? isInteger(v) : isNumber(v)) &&
      (exclusiveMin ? (v as number) > min : (v as number) >= min) && (v as number) <= max;
    this.expect(ok, p, `${integer ? "Ganzzahl" : "Zahl"} im Bereich erwartet`);
  }

  workspace = (v: Json, p: string) => {
    if (!this.object(v, p, ["width", "height"], ["width", "height"])) return;
    this.range(v.width, pointer(p, "width"), 0, 16384, true);
    this.range(v.height, pointer(p, "height"), 0, 16384, true);
  };

  rootTransform = (v: Json, p: string) => {
    if (!this.object(v, p, ["scale", "offsetX", "offsetY"], ["scale", "offsetX", "offsetY"])) return;
    this.range(v.scale, pointer(p, "scale"), 0, 1000, true);
    this.number(v.offsetX, pointer(p, "offsetX"));
    this.number(v.offsetY, pointer(p, "offsetY"));
  };

  signalDefinition = (v: Json, p: string) => {
    if (!this.object(v, p, ["label", "unit", "decimals"], ["label"])) return;
    this.displayName(v.label, pointer(p, "label"));
    this.opt(v, "unit", p, (u, up) => this.expect(isString(u, 32), up, "Text ≤ 32 Zeichen erwartet"));
    this.opt(v, "decimals", p, (d, dp) => this.range(d, dp, 0, 6, false, true));
  };

  sources = (v: Json, p: string) => {
    if (!this.object(v, p, ["telemetry"])) return;
    this.opt(v, "telemetry", p, (t, tp) =>
      this.map(t, tp, (k) => length(k) >= 1 && length(k) <= 64, (s, sp) => {
        if (!this.object(s, sp, ["staleAfterMs"])) return;
        this.opt(s, "staleAfterMs", sp, (x, xp) => this.range(x, xp, 500, 600000, false, true));
      }));
  };

  literal = (v: Json, p: string) => {
    const ok = v === null || typeof v === "boolean" || isNumber(v) || isString(v, 1000);
    this.expect(ok, p, "Zahl, Text ≤ 1000, Bool oder null erwartet");
  };

  binding = (v: Json, p: string) => {
    if (!this.object(v, p, ["expr", "smoothing"], ["expr"])) return;
    this.expression(v.expr, pointer(p, "expr"));
    this.opt(v, "smoothing", p, (s, sp) => {
      if (!this.object(s, sp, ["timeConstantS"], ["timeConstantS"])) return;
      this.range(s.timeConstantS, pointer(sp, "timeConstantS"), 0, 60, true);
    });
  };

  rate = (v: Json, p: string) => {
    if (!this.object(v, p, ["expr", "wrap"], ["expr"])) return;
    this.expression(v.expr, pointer(p, "expr"));
    this.opt(v, "wrap", p, (w, wp) => {
      if (!this.object(w, wp, ["min", "max"], ["min", "max"])) return;
      this.number(w.min, pointer(wp, "min"));
      this.number(w.max, pointer(wp, "max"));
    });
  };

  propertyValue = (v: Json, p: string) => {
    if (!isObject(v)) return this.literal(v, p);
    if (!this.object(v, p, ["base", "binding", "rate"], ["base"])) return;
    this.literal(v.base, pointer(p, "base"));
    const hasBinding = v.binding !== undefined;
    const hasRate = v.rate !== undefined;
    this.expect(hasBinding !== hasRate, p, "genau eines von binding oder rate erwartet");
    this.opt(v, "binding", p, this.binding);
    this.opt(v, "rate", p, this.rate);
  };

  propMap = (v: Json, p: string) => this.map(v, p, (k) => PROP.test(k), this.propertyValue);

  /** Parts of an element; in a variant override `interaction` is not allowed (D75). */
  partMap = (v: Json, p: string, override = false) =>
    this.map(v, p, (k) => ID.test(k), (part, pp) => {
      if (!this.object(part, pp, override ? ["props", "lockAspect"] : ["props", "lockAspect", "interaction"])) return;
      this.opt(part, "props", pp, this.propMap);
      this.opt(part, "lockAspect", pp, this.bool);
      this.opt(part, "interaction", pp, this.interaction);
    });

  interaction = (v: Json, p: string) => {
    if (!this.object(v, p, ["input", "kind", "value", "min", "max", "step", "public"], ["input", "kind"])) return;
    this.expect(typeof v.input === "string" && SIGNAL.test(v.input), pointer(p, "input"), "ungültiger Eingabename");
    this.expect(typeof v.kind === "string" && INTERACTION_KINDS.includes(v.kind), pointer(p, "kind"), "button, toggle, value oder slider erwartet");
    for (const key of ["value", "min", "max"]) this.opt(v, key, p, this.number);
    this.opt(v, "step", p, (s, sp) => this.range(s, sp, 0, 1000000, true));
    this.opt(v, "public", p, this.bool);
  };

  commonAttributes(v: Record<string, Json>, p: string): void {
    this.opt(v, "name", p, this.displayName);
    for (const flag of ["disabled", "locked", "editorHidden", "lockAspect"]) this.opt(v, flag, p, this.bool);
    this.opt(v, "onInvalid", p, (o, op) => this.expect(o === "hold" || o === "hide", op, "hold oder hide erwartet"));
    this.opt(v, "props", p, this.propMap);
    this.opt(v, "interaction", p, this.interaction);
  }

  element = (v: Json, p: string) => {
    if (!isObject(v)) return this.report(p, "Objekt erwartet");
    const type = v.type;
    if (type === "group") {
      if (!this.object(v, p, [...COMMON_ATTRS, "children"], ["type", "children"])) return;
      this.idList(v.children, pointer(p, "children"));
    } else if (typeof type === "string" && SHAPES.includes(type)) {
      if (!this.object(v, p, COMMON_ATTRS, ["type"])) return;
    } else if (type === "svgAsset") {
      if (!this.object(v, p, [...COMMON_ATTRS, "assetId", "parts"], ["type", "assetId"])) return;
      this.expect(typeof v.assetId === "string" && ASSET.test(v.assetId), pointer(p, "assetId"), "ungültige assetId");
      this.opt(v, "parts", p, this.partMap);
    } else if (type === "lidarWidget") {
      if (!this.object(v, p, [...COMMON_ATTRS, "source"], ["type", "source"])) return;
      this.expect(isString(v.source, 64, 1), pointer(p, "source"), "Kanalname erwartet");
    } else {
      return this.report(pointer(p, "type"), "unbekannter Elementtyp");
    }
    this.commonAttributes(v, p);
  };

  elementMap = (v: Json, p: string) =>
    this.map(v, p, (k) => ID.test(k) && k !== "root", this.element);

  keyframe = (v: Json, p: string) => {
    if (!this.object(v, p, ["t", "value", "easing"], ["t", "value"])) return;
    this.range(v.t, pointer(p, "t"), 0, Number.MAX_VALUE);
    this.literal(v.value, pointer(p, "value"));
    this.opt(v, "easing", p, (e, ep) =>
      this.expect(["linear", "easeIn", "easeOut", "easeInOut", "step"].includes(e as string), ep, "unbekanntes Easing"));
  };

  track = (v: Json, p: string) => {
    if (!this.object(v, p, ["element", "part", "property", "keyframes"], ["element", "property", "keyframes"])) return;
    this.id(v.element, pointer(p, "element"));
    this.opt(v, "part", p, this.id);
    this.expect(typeof v.property === "string" && PROP.test(v.property), pointer(p, "property"), "ungültiger Eigenschaftsname");
    const kp = pointer(p, "keyframes");
    if (!Array.isArray(v.keyframes) || v.keyframes.length < 1 || v.keyframes.length > 500) {
      return this.report(kp, "1–500 Keyframes erwartet");
    }
    v.keyframes.forEach((k, i) => this.keyframe(k, pointer(kp, i)));
  };

  trigger = (v: Json, p: string) => {
    if (!isObject(v)) return this.report(p, "Objekt erwartet");
    if (v.mode === "auto") {
      this.object(v, p, ["mode"], ["mode"]);
    } else if (v.mode === "whileTrue") {
      if (!this.object(v, p, ["mode", "condition", "onDeactivate"], ["mode", "condition"])) return;
      this.expression(v.condition, pointer(p, "condition"));
      this.opt(v, "onDeactivate", p, (o, op) => this.expect(o === "stop" || o === "finish", op, "stop oder finish erwartet"));
    } else if (v.mode === "pulse") {
      if (!this.object(v, p, ["mode", "condition", "retrigger"], ["mode", "condition"])) return;
      this.expression(v.condition, pointer(p, "condition"));
      this.opt(v, "retrigger", p, (o, op) => this.expect(o === "restart" || o === "ignore", op, "restart oder ignore erwartet"));
    } else {
      this.report(pointer(p, "mode"), "unbekannter Auslöser");
    }
  };

  clipSettings(v: Json, p: string, required: string[]): void {
    if (!this.object(v, p, CLIP_KEYS, required)) return;
    this.opt(v, "name", p, this.displayName);
    this.opt(v, "disabled", p, this.bool);
    this.opt(v, "durationS", p, (d, dp) => this.range(d, dp, 0, 3600, true));
    this.opt(v, "repeat", p, (r, rp) =>
      this.expect(r === "infinite" || (isInteger(r) && r >= 1 && r <= 10000), rp, "1–10000 oder infinite erwartet"));
    this.opt(v, "trigger", p, this.trigger);
    this.opt(v, "endState", p, (e, ep) => this.expect(e === "base" || e === "hold", ep, "base oder hold erwartet"));
    this.opt(v, "tracks", p, (t, tp) => {
      if (!Array.isArray(t) || t.length > 200) return this.report(tp, "höchstens 200 Spuren erwartet");
      t.forEach((track, i) => this.track(track, pointer(tp, i)));
    });
  }

  clipMap = (v: Json, p: string) =>
    this.map(v, p, (k) => ID.test(k), (c, cp) => this.clipSettings(c, cp, ["durationS", "trigger", "tracks"]));

  elementOverride = (v: Json, p: string) => {
    if (!this.object(v, p, ["disabled", "locked", "editorHidden", "lockAspect", "onInvalid", "props", "parts"])) return;
    for (const flag of ["disabled", "locked", "editorHidden", "lockAspect"]) this.opt(v, flag, p, this.bool);
    this.opt(v, "onInvalid", p, (o, op) => this.expect(o === "hold" || o === "hide", op, "hold oder hide erwartet"));
    this.opt(v, "props", p, this.propMap);
    this.opt(v, "parts", p, (parts, pp) => this.partMap(parts, pp, true));
  };

  variant = (v: Json, p: string) => {
    const keys = ["disabled", "workspace", "rootTransform", "elements", "addedElements", "structure", "clips", "addedClips"];
    if (!this.object(v, p, keys)) return;
    this.opt(v, "disabled", p, this.bool);
    this.opt(v, "workspace", p, this.workspace);
    this.opt(v, "rootTransform", p, this.rootTransform);
    this.opt(v, "elements", p, (e, ep) => this.map(e, ep, (k) => ID.test(k), this.elementOverride));
    this.opt(v, "addedElements", p, this.elementMap);
    this.opt(v, "structure", p, (s, sp) => {
      if (!this.object(s, sp, ["parents", "order"])) return;
      this.opt(s, "parents", sp, (m, mp) => this.map(m, mp, (k) => ID.test(k), this.id));
      this.opt(s, "order", sp, (m, mp) => this.map(m, mp, (k) => ID.test(k), this.idList));
    });
    this.opt(v, "clips", p, (c, cp) => this.map(c, cp, (k) => ID.test(k), (o, op) => this.clipSettings(o, op, [])));
    this.opt(v, "addedClips", p, this.clipMap);
  };

  document = (v: Json) => {
    const keys = ["schemaVersion", "workspace", "rootTransform", "disabled", "signals", "sources", "elements", "children", "clips", "variants"];
    if (!this.object(v, "", keys, ["schemaVersion", "workspace", "elements", "children"])) {
      if (!isObject(v)) return;
    }
    this.opt(v, "workspace", "", this.workspace);
    this.opt(v, "rootTransform", "", this.rootTransform);
    this.opt(v, "disabled", "", this.bool);
    this.opt(v, "signals", "", (s, sp) => this.map(s, sp, (k) => SIGNAL.test(k), this.signalDefinition));
    this.opt(v, "sources", "", this.sources);
    this.opt(v, "elements", "", this.elementMap);
    this.opt(v, "children", "", this.idList);
    this.opt(v, "clips", "", this.clipMap);
    this.opt(v, "variants", "", (m, mp) => this.map(m, mp, (k) => length(k) >= 1 && length(k) <= 50, this.variant));
  };
}

/**
 * Structural check of a document. An unsupported schemaVersion is reported
 * on its own as OVL_SCHEMA_UNSUPPORTED; every other violation as
 * OVL_SCHEMA_INVALID with a JSON pointer.
 */
export function checkSchema(doc: unknown): Diagnostic[] {
  if (isObject(doc) && doc.schemaVersion !== undefined && doc.schemaVersion !== 1) {
    return [{
      code: "OVL_SCHEMA_UNSUPPORTED",
      category: "structure",
      severity: "error",
      location: { path: "/schemaVersion" },
      message: `Schema-Version ${JSON.stringify(doc.schemaVersion)} wird nicht unterstützt`,
    }];
  }
  const diagnostics: Diagnostic[] = [];
  const checker = new Checker((path, message) => diagnostics.push({
    code: "OVL_SCHEMA_INVALID",
    category: "structure",
    severity: "error",
    location: { path },
    message,
  }));
  checker.document(doc);
  return diagnostics;
}
