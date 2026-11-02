// Test double of the browser backup store; survives "reloads" by sharing the instance.
import { detach } from "../../document/dict";
import type { BackupEntry, BackupStore } from "../persistence/backup";

export class MemoryBackupStore implements BackupStore {
  readonly entries: BackupEntry[] = [];
  failing = false;

  async put(entry: BackupEntry, keep: number): Promise<void> {
    if (this.failing) throw new Error("quota");
    const i = this.entries.findIndex((e) => e.carId === entry.carId && e.savedAt === entry.savedAt);
    if (i >= 0) this.entries.splice(i, 1);
    this.entries.push(detach(entry));
    const mine = this.entries.filter((e) => e.carId === entry.carId).sort((a, b) => a.savedAt - b.savedAt);
    for (const old of mine.slice(0, Math.max(0, mine.length - keep))) this.entries.splice(this.entries.indexOf(old), 1);
  }

  async list(carId: number): Promise<BackupEntry[]> {
    if (this.failing) throw new Error("unavailable");
    return this.entries.filter((e) => e.carId === carId).sort((a, b) => b.savedAt - a.savedAt).map((e) => detach(e));
  }
}
