// AP01 – document resolution and validation (Shared/Overlay/modules/README.md §1).
export * from "./types";
export { catalog, propDef, allowedModes, defaultLockAspect } from "./catalog";
export { checkSchema } from "./schema";
export { validate, canSave, canPublish } from "./validate";
export { resolve, effectiveConfig } from "./resolve";
export { deletionImpact, deleteElements } from "./deletion";
export type { DeletionImpact, VariantImpact } from "./deletion";
