// Autosave, conflicts, loss of control, two tabs, reconnect and restart
// (api/README.md §5) against the in-memory server and backup store.
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../../document/types";
import { ManualClock } from "../../sources/testing/manual-clock";
import { EditorStore } from "../core/store";
import { InMemoryOverlayServer } from "../testing/in-memory-persistence";
import { MemoryBackupStore } from "../testing/memory-backup-store";
import { SaveController } from "./autosave";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

const serverDoc = (): OverlayDocument => ({
  schemaVersion: 1,
  workspace: { width: 400, height: 200 },
  elements: { e_a: { type: "rect", props: { x: 10 } } },
  children: ["e_a"],
});

interface Tab {
  store: EditorStore;
  save: SaveController;
  clock: ManualClock;
  setX(v: number): void;
}

async function openTab(server: InMemoryOverlayServer, backups = new MemoryBackupStore(), clock = new ManualClock(), wall = { t: 1_000_000 }): Promise<Tab> {
  const store = new EditorStore({ carId: server.carId, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
  const save = new SaveController({ store, persistence: server.client(), backups, clock, wallClock: () => wall.t + clock.now() });
  await save.open();
  await settle();
  return { store, save, clock, setX: (v) => store.dispatch({ type: "setProperty", element: "e_a", property: "x", value: v }) };
}

function newServer() {
  const server = new InMemoryOverlayServer(7);
  server.document = serverDoc();
  server.revision = 3;
  return server;
}

const writes = (server: InMemoryOverlayServer) => server.log.filter((l) => l.method === "PUT" || l.method === "PATCH");

describe("autosave timing and format (D25, D63)", () => {
  it("loads, saves 2 s after the last change, first as PUT then as PATCH", async () => {
    const server = newServer();
    const tab = await openTab(server);
    expect(tab.save.getState()).toMatchObject({ status: "saved", baseRevision: 3, dirty: false });
    expect(tab.store.document.elements.e_a.props!.x).toBe(10);
    tab.setX(20);
    expect(tab.save.getState().status).toBe("unsaved");
    tab.clock.advance(1900);
    await settle();
    expect(writes(server)).toHaveLength(0);
    tab.clock.advance(100);
    await settle();
    expect(writes(server).map((w) => w.method)).toEqual(["PUT"]);
    expect(tab.save.getState()).toMatchObject({ status: "saved", baseRevision: 4, dirty: false });
    tab.setX(30);
    tab.clock.advance(2000);
    await settle();
    const patch = writes(server)[1];
    expect(patch.method).toBe("PATCH");
    expect(patch.ifMatch).toBe(4);
    expect(patch.body).toEqual([{ op: "replace", path: "/elements/e_a/props/x", value: 30 }]);
    expect(server.document.elements.e_a.props!.x).toBe(30);
  });

  it("saves at the latest after 30 s of continuous editing; nothing without changes", async () => {
    const server = newServer();
    const tab = await openTab(server);
    for (let i = 1; i <= 29; i++) {
      tab.setX(i);
      tab.clock.advance(1000);
      await settle();
    }
    expect(writes(server)).toHaveLength(0);
    tab.setX(100);
    tab.clock.advance(1000);
    await settle();
    expect(writes(server)).toHaveLength(1);
    expect(server.document.elements.e_a.props!.x).toBe(100);
    tab.clock.advance(60000);
    await settle();
    expect(writes(server)).toHaveLength(1);
  });

  it("undo back to the confirmed state is no change; saving keeps the undo stack", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.setX(20);
    await tab.save.flush();
    tab.setX(30);
    expect(tab.save.getState().dirty).toBe(true);
    tab.store.undo();
    expect(tab.save.getState()).toMatchObject({ dirty: false, status: "saved" });
    expect(tab.store.getState().history.size).toBe(1);
    tab.store.undo();
    await tab.save.flush();
    expect(server.document.elements.e_a.props!.x).toBe(10);
    expect(tab.store.getState().history.canRedo).toBe(true);
  });

  it("at most one request at a time; changes during the request are saved afterwards", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.setX(20);
    server.hold();
    tab.clock.advance(2000);
    await settle();
    expect(tab.save.getState().status).toBe("saving");
    tab.setX(21);
    tab.clock.advance(5000);
    await settle();
    expect(server.heldCount).toBe(1);
    server.release();
    await settle();
    expect(tab.save.getState().status).toBe("unsaved");
    tab.clock.advance(2000);
    await settle();
    expect(writes(server).map((w) => w.method)).toEqual(["PUT", "PATCH"]);
    expect(server.document.elements.e_a.props!.x).toBe(21);
    expect(tab.save.getState()).toMatchObject({ status: "saved", baseRevision: 5 });
  });

  it("422 PATCH_FAILED is followed by exactly one PUT; large differences use PUT", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.setX(20);
    await tab.save.flush();
    tab.setX(21);
    server.failNext({ status: 422, code: "OVL_API_PATCH_FAILED" });
    await tab.save.flush();
    expect(writes(server).map((w) => w.method)).toEqual(["PUT", "PATCH", "PUT"]);
    expect(tab.save.getState().status).toBe("saved");
    tab.store.dispatch({ type: "addElements", elements: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`e_n${i}`, { type: "rect" as const }])), roots: Array.from({ length: 20 }, (_, i) => `e_n${i}`) });
    await tab.save.flush();
    expect(writes(server).at(-1)!.method).toBe("PUT");
  });

  it("network errors retry with backoff", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.setX(20);
    server.failNext("network", "network");
    await tab.save.flush();
    expect(tab.save.getState().status).toBe("error");
    tab.clock.advance(2000);
    await settle();
    expect(tab.save.getState().status).toBe("error");
    tab.clock.advance(5000);
    await settle();
    expect(tab.save.getState().status).toBe("saved");
    expect(server.document.elements.e_a.props!.x).toBe(20);
  });

  it("documents with structure errors are not sent", async () => {
    const server = newServer();
    const store = new EditorStore({ carId: 7, document: serverDoc(), guardStructure: false });
    const save = new SaveController({ store, persistence: server.client(), clock: new ManualClock() });
    await save.open();
    store.dispatch({ type: "setProperty", element: "e_a", property: "opacity", value: "x" });
    await save.flush();
    expect(save.getState()).toMatchObject({ status: "error", error: { code: "OVL_API_INVALID_DOCUMENT" } });
    expect(writes(server)).toHaveLength(0);
  });
});

describe("conflicts (server wins)", () => {
  it("409 pauses autosave, keeps the local state as backup and download", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const tab = await openTab(server, backups);
    server.holdEvents = true;
    server.externalSave({ ...serverDoc(), workspace: { width: 999, height: 1 } });
    tab.setX(55);
    await tab.save.flush();
    await settle();
    expect(tab.save.getState()).toMatchObject({ status: "conflict", conflictRevision: 4 });
    tab.setX(56);
    tab.clock.advance(60000);
    await settle();
    expect(writes(server)).toHaveLength(1);
    const pkg = tab.save.backupPackage();
    expect(pkg).toMatchObject({ format: "signalrc-overlay-package", kind: "backup", baseRevision: 3 });
    expect(pkg.document.elements.e_a.props!.x).toBe(56);
    expect(backups.entries.at(-1)!.package.document.elements.e_a.props!.x).toBe(56);
    await tab.save.loadServerState();
    expect(tab.save.getState()).toMatchObject({ status: "saved", baseRevision: 4 });
    expect(tab.store.document.workspace.width).toBe(999);
    expect(server.document.workspace.width).toBe(999);
    expect(backups.entries.some((e) => e.package.document.elements.e_a.props!.x === 56)).toBe(true);
  });

  it("two tabs: the second goes into conflict as soon as the first saves, without saving", async () => {
    const server = newServer();
    const a = await openTab(server);
    const b = await openTab(server);
    a.setX(1);
    b.setX(2);
    await a.save.flush();
    await settle();
    expect(a.save.getState().status).toBe("saved");
    expect(b.save.getState()).toMatchObject({ status: "conflict", conflictRevision: 4 });
    b.clock.advance(60000);
    await settle();
    expect(server.document.elements.e_a.props!.x).toBe(1);
    expect(writes(server)).toHaveLength(1);
    expect(b.store.document.elements.e_a.props!.x).toBe(2);
  });

  it("own events never cause a conflict, before or after the response", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.setX(5);
    await tab.save.flush();
    server.holdEvents = true;
    tab.setX(6);
    await tab.save.flush();
    server.flushEvents();
    await settle();
    expect(tab.save.getState().status).toBe("saved");
    // Delayed event of an older own revision.
    server.emit({ type: "draftChanged", carId: 7, revision: 4 });
    server.flushEvents();
    expect(tab.save.getState().status).toBe("saved");
  });
});

describe("loss of control", () => {
  it("403 NOT_DRIVER: local editing goes on, nothing is sent; regaining with the same revision continues", async () => {
    const server = newServer();
    const tab = await openTab(server);
    server.driver = false;
    tab.setX(20);
    await tab.save.flush();
    expect(tab.save.getState()).toMatchObject({ status: "localOnly", hasControl: false });
    const before = server.log.length;
    tab.setX(21);
    tab.clock.advance(60000);
    await settle();
    expect(server.log.length).toBe(before);
    expect(tab.save.getState().status).toBe("localOnly");
    server.driver = true;
    tab.save.setControl(true);
    await settle();
    expect(server.log.at(-1)!.method).toBe("GET");
    expect(tab.save.getState().status).toBe("unsaved");
    tab.clock.advance(2000);
    await settle();
    expect(server.document.elements.e_a.props!.x).toBe(21);
  });

  it("control change from the app blocks requests; a newer revision after regaining is a conflict", async () => {
    const server = newServer();
    const tab = await openTab(server);
    tab.save.setControl(false);
    expect(tab.save.getState().status).toBe("localOnly");
    tab.setX(20);
    tab.clock.advance(60000);
    await settle();
    expect(writes(server)).toHaveLength(0);
    server.holdEvents = true;
    server.externalSave(serverDoc());
    tab.save.setControl(true);
    await settle();
    expect(tab.save.getState()).toMatchObject({ status: "conflict", conflictRevision: 4 });
    expect(writes(server)).toHaveLength(0);
  });

  it("opening without control loads nothing and offers backups only as download", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const first = await openTab(server, backups);
    first.setX(42);
    first.clock.advance(10);
    await settle();
    server.driver = false;
    const second = await openTab(server, backups);
    expect(second.save.getState()).toMatchObject({ status: "localOnly", hasControl: false });
    expect(second.save.getState().backups[0]).toMatchObject({ canContinue: false });
  });
});

describe("reconnect", () => {
  it("re-checks the revision after a reconnect and detects missed changes", async () => {
    const server = newServer();
    const tab = await openTab(server);
    server.emit({ type: "reconnected", carId: 7 });
    await settle();
    expect(tab.save.getState().status).toBe("saved");
    server.holdEvents = true;
    server.externalSave(serverDoc());
    server.holdEvents = false;
    server.emit({ type: "reconnected", carId: 7 });
    await settle();
    expect(tab.save.getState()).toMatchObject({ status: "conflict", conflictRevision: 4 });
  });
});

describe("local backups and restart (D25)", () => {
  it("writes at most once per second and keeps the last five per vehicle", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const tab = await openTab(server, backups);
    tab.setX(1);
    await settle();
    tab.setX(2);
    tab.setX(3);
    await settle();
    expect(backups.entries).toHaveLength(1);
    tab.clock.advance(1000);
    await settle();
    expect(backups.entries).toHaveLength(2);
    expect(backups.entries[1].package.document.elements.e_a.props!.x).toBe(3);
    for (let i = 0; i < 10; i++) {
      tab.setX(100 + i);
      tab.clock.advance(1000);
      await settle();
    }
    expect(backups.entries).toHaveLength(5);
    expect(backups.entries.every((e) => e.carId === 7 && e.package.kind === "backup")).toBe(true);
  });

  it("after a reload the backup is offered to continue only with an unchanged base revision", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const tab = await openTab(server, backups);
    server.driver = false;
    tab.setX(77);
    await tab.save.flush();
    await settle();
    tab.save.dispose();

    // Reload: new store/controller, same browser storage.
    server.driver = true;
    const reloaded = await openTab(server, backups, new ManualClock(), { t: 2_000_000 });
    const offer = reloaded.save.getState().backups[0];
    expect(offer).toMatchObject({ canContinue: true });
    expect(reloaded.save.continueFromBackup(offer.entry)).toBe(true);
    expect(reloaded.store.document.elements.e_a.props!.x).toBe(77);
    expect(reloaded.store.getState().history.undoLabel).toBe("Sicherung übernehmen");
    await reloaded.save.flush();
    expect(writes(server).at(-1)!.method).toBe("PUT");
    expect(server.document.elements.e_a.props!.x).toBe(77);
  });

  it("a backup of an older revision is only available as download", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const tab = await openTab(server, backups);
    tab.save.setControl(false);
    tab.setX(66);
    await settle();
    tab.save.dispose();
    server.externalSave(serverDoc());
    const reloaded = await openTab(server, backups, new ManualClock(), { t: 3_000_000 });
    const offer = reloaded.save.getState().backups[0];
    expect(offer).toMatchObject({ canContinue: false });
    expect(reloaded.save.continueFromBackup(offer.entry)).toBe(false);
    expect(reloaded.store.document.elements.e_a.props!.x).toBe(10);
    expect(backups.entries).toHaveLength(1);
  });

  it("failing browser storage is reported but does not stop editing", async () => {
    const server = newServer();
    const backups = new MemoryBackupStore();
    const tab = await openTab(server, backups);
    backups.failing = true;
    tab.setX(5);
    await settle();
    expect(tab.save.getState().backupFailed).toBe(true);
    await tab.save.flush();
    expect(tab.save.getState().status).toBe("saved");
  });
});
