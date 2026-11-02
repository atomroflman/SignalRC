// Typed access to the property catalog. The JSON is a copy of
// Shared/Overlay/catalog/property-catalog.json (the Client Docker build cannot
// reach Shared/); catalog.test.ts fails when the copy drifts.
import catalogJson from "../contracts/property-catalog.json";
import type { ElementType } from "./types";

export type ControlMode = "static" | "binding" | "rate" | "clip";

export interface KindDef {
  valueType: "number" | "boolean" | "string" | "any";
  integer?: boolean;
  min?: number;
  max?: number;
  clamp?: boolean;
  maxLength?: number;
  format?: "color";
  interpolation: string;
  modes: ControlMode[];
}

export interface PropDef {
  kind: string;
  default: unknown;
  min?: number;
  max?: number;
  integer?: boolean;
  values?: (string | number)[];
  modes?: ControlMode[];
  absentWhen?: "lockAspect";
}

interface TypeDef {
  props: Record<string, PropDef>;
  partProps?: string[];
  partPropDefs?: Record<string, PropDef>;
}

interface Catalog {
  catalogVersion: number;
  kinds: Record<string, KindDef>;
  common: Record<string, PropDef>;
  types: Record<string, TypeDef>;
}

export const catalog = catalogJson as unknown as Catalog;

export const ELEMENT_TYPES = Object.keys(catalog.types) as ElementType[];

/** Definition of a property of an element type, or of an svgAsset part. */
export function propDef(type: ElementType, name: string, part = false): PropDef | undefined {
  const typeDef = catalog.types[type];
  if (!typeDef) return undefined;
  if (part) {
    if (!typeDef.partProps?.includes(name)) return undefined;
    return typeDef.partPropDefs?.[name] ?? catalog.common[name];
  }
  return typeDef.props[name] ?? catalog.common[name];
}

export function kindDef(def: PropDef): KindDef {
  return catalog.kinds[def.kind];
}

export function allowedModes(def: PropDef): ControlMode[] {
  return def.modes ?? kindDef(def).modes;
}

/** lockAspect default per D02: groups and SVG assets scale proportionally. */
export function defaultLockAspect(type: ElementType): boolean {
  return type === "group" || type === "svgAsset";
}

const COLOR = /^(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|none)$/;

/** Checks a static value against a property definition. Returns a problem or null. */
export function checkLiteral(def: PropDef, value: unknown): "type" | "range" | null {
  const kind = kindDef(def);
  if (value === null) return kind.valueType === "any" ? null : "type";
  switch (kind.valueType) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "type";
      if ((def.integer ?? kind.integer) && !Number.isInteger(value)) return "type";
      if (def.values && !def.values.includes(value)) return "range";
      const min = def.min ?? kind.min;
      const max = def.max ?? kind.max;
      if (min !== undefined && value < min) return "range";
      if (max !== undefined && value > max) return "range";
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : "type";
    case "string": {
      if (typeof value !== "string") return "type";
      if (kind.format === "color" && !COLOR.test(value)) return "type";
      if (def.values && !def.values.includes(value)) return "range";
      return null;
    }
    case "any":
      return null;
  }
}

/** Expected formula result kind for a property (expression/README.md §3). */
export function expectedKind(def: PropDef): string {
  return def.kind;
}
