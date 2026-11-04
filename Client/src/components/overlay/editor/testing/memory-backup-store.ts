// Test double of the browser backup store; survives "reloads" by sharing the instance.
import { detach } from "../../document/dict";
import { isUsableEntry, rotation, type BackupEntry, type BackupStore } from "../persistence/backup";

export class MemoryBackupStore implements BackupStore {
  /** Raw stored entries; tests may add legacy or broken ones. */
  readonly entries: BackupEntry[] = [];
  failing = false;

  async put(entry: BackupEntry, keep: number): Promise<void> {
    if (this.failing) throw new Error("quota");
    const i = this.entries.findIndex((e) => e.carId === entry.carId && e.savedAt === entry.savedAt);
    if (i >= 0) this.entries.splice(i, 1);
    this.entries.push(detach(entry));
    const drop = new Set(rotation(this.entries.filter((e) => e.carId === entry.carId), entry, keep).map(([, savedAt]) => savedAt));
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].carId === entry.carId && drop.has(this.entries[i].savedAt)) this.entries.splice(i, 1);
    }
  }

  async list(carId: number): Promise<BackupEntry[]> {
    if (this.failing) throw new Error("unavailable");
    return this.entries.filter((e) => e.carId === carId && isUsableEntry(e)).sort((a, b) => b.savedAt - a.savedAt).map((e) => detach(e));
  }
}
