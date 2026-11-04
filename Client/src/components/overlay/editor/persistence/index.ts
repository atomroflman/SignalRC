// AP09 – persistence adapter, autosave and local backups (see ../README.md).
export * from "./types";
export { HttpOverlayPersistence } from "./http";
export type { HttpPersistenceOptions, Fetch } from "./http";
export { SaveController } from "./autosave";
export type { SaveState, SaveStatus, SaveError, BackupOffer, SaveControllerOptions } from "./autosave";
export { IndexedDbBackupStore, defaultBackupStore, backupPackage, downloadPackage, packageFileName, referencedAssets } from "./backup";
export type { BackupEntry, BackupStore, OverlayPackage, PackageSource } from "./backup";
