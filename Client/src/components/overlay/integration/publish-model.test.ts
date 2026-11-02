import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { InMemoryOverlayServer, startDocument } from "../editor/testing/in-memory-persistence";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { OverlayApiError } from "../editor/persistence/types";
import {
  activePublication, NOTE_MAX, publishBlockers, publishDraft, publishUnavailable, restorePublication, sortHistory,
} from "./publish-model";

async function setup() {
  const server = new InMemoryOverlayServer(1);
  const persistence = server.client();
  const store = new EditorStore({ carId: 1, document: startDocument() });
  const save = new SaveController({ store, persistence, backups: new MemoryBackupStore(), debounceMs: 10_000, maxDelayMs: 60_000 });
  await save.open();
  return { server, persistence, store, save, deps: { carId: 1, save, persistence } };
}

const diag = (category: Diagnostic["category"]): Diagnostic => ({ code: "X", category, severity: category === "warning" ? "warning" : "error", message: "m", location: {} }) as Diagnostic;

describe("publish availability", () => {
  it("blocks on errors, not on warnings", () => {
    expect(publishBlockers([diag("warning"), diag("publish"), diag("structure")])).toHaveLength(2);
    expect(publishUnavailable({ status: "saved", hasControl: true }, [], "")).toBeNull();
    expect(publishUnavailable({ status: "saved", hasControl: true }, [diag("publish")], "")).toBe("blocked");
  });

  it("needs control, a loaded draft without conflict and a short note", () => {
    expect(publishUnavailable({ status: "localOnly", hasControl: false }, [], "")).toBe("noControl");
    expect(publishUnavailable({ status: "loading", hasControl: true }, [], "")).toBe("loading");
    expect(publishUnavailable({ status: "conflict", hasControl: true }, [], "")).toBe("conflict");
    expect(publishUnavailable({ status: "unsaved", hasControl: true }, [], "x".repeat(NOTE_MAX))).toBeNull();
    expect(publishUnavailable({ status: "unsaved", hasControl: true }, [], "x".repeat(NOTE_MAX + 1))).toBe("noteTooLong");
  });
});

describe("publishing the draft", () => {
  it("saves pending changes first and publishes exactly that revision with the note", async () => {
    const { server, store, deps } = await setup();
    store.dispatch({ type: "addElements", elements: { e_v: { type: "valueText", props: { x: 10 } } }, roots: ["e_v"] });
    store.dispatch({ type: "setProperty", element: "e_v", property: "rotation", value: 30 });
    const r = await publishDraft(deps, "  erste Version  ");
    expect(r).toMatchObject({ kind: "published", number: 1 });
    const pub = server.log.find((l) => l.method === "POST" && l.path === "publications");
    expect(pub?.body).toEqual({ baseRevision: 1, note: "erste Version" });
    expect(server.publications[0].document.elements.e_v.props?.rotation).toBe(30);
  });

  it("sends no note when it is empty and refuses a note over the limit", async () => {
    const { server, deps } = await setup();
    expect((await publishDraft(deps, "x".repeat(NOTE_MAX + 1))).kind).toBe("failed");
    expect(server.log.some((l) => l.path === "publications")).toBe(false);
    await publishDraft(deps, "   ");
    expect(server.log.find((l) => l.path === "publications")?.body).toEqual({ baseRevision: 0, note: undefined });
  });

  it("does not publish after losing control; the server refuses as well", async () => {
    const { server, store, save, deps } = await setup();
    save.setControl(false);
    store.dispatch({ type: "setWorkspace", width: 800, height: 600, mode: "areaOnly" });
    expect(await publishDraft(deps, "")).toEqual({ kind: "noControl" });
    save.setControl(true);
    await new Promise((r) => setTimeout(r, 0));
    server.driver = false;
    expect((await publishDraft(deps, "")).kind).toBe("noControl");
    expect(server.publications).toHaveLength(0);
  });

  it("reports a conflict instead of publishing a foreign revision", async () => {
    const { server, store, deps } = await setup();
    server.externalSave({ ...startDocument(), workspace: { width: 640, height: 480 } });
    store.dispatch({ type: "addElements", elements: { e_r: { type: "rect", props: {} } }, roots: ["e_r"] });
    expect((await publishDraft(deps, "")).kind).toBe("conflict");
    expect(server.publications).toHaveLength(0);
  });

  it("passes the server's publish diagnostics on", async () => {
    const { deps, persistence } = await setup();
    const blocked: Diagnostic[] = [diag("publish")];
    persistence.publish = async () => { throw new OverlayApiError(422, "OVL_API_PUBLISH_BLOCKED", "blocked", undefined, blocked); };
    expect(await publishDraft(deps, "")).toEqual({ kind: "blocked", diagnostics: blocked });
  });
});

describe("history and restore", () => {
  it("restores a publication as draft; the published HUD stays the same", async () => {
    const { server, store, deps, save } = await setup();
    store.dispatch({ type: "addElements", elements: { e_a: { type: "rect", props: { x: 1 } } }, roots: ["e_a"] });
    const first = await publishDraft(deps, "v1");
    expect(first.kind).toBe("published");
    store.dispatch({ type: "setProperty", element: "e_a", property: "x", value: 99 });
    await save.flush();
    const r = await restorePublication(deps, server.publications[0].id);
    expect(r.kind).toBe("restored");
    expect(store.document.elements.e_a.props?.x).toBe(1);
    expect(server.document.elements.e_a.props?.x).toBe(1);
    expect(server.publications).toHaveLength(1);
    expect(save.getState()).toMatchObject({ status: "saved", dirty: false });
  });

  it("saves local changes before restoring so they stay in the draft history", async () => {
    const { server, store, deps } = await setup();
    await publishDraft(deps, "");
    store.dispatch({ type: "addElements", elements: { e_b: { type: "rect", props: {} } }, roots: ["e_b"] });
    const before = server.revision;
    await restorePublication(deps, server.publications[0].id);
    const puts = server.log.filter((l) => l.method === "PUT" || l.method === "PATCH");
    expect(puts.length).toBeGreaterThan(0);
    expect(server.revision).toBe(before + 2);
  });

  it("orders the history and marks the newest publication active", () => {
    const list = [{ id: 1, number: 1, publishedAt: "" }, { id: 3, number: 3, publishedAt: "" }, { id: 2, number: 2, publishedAt: "" }];
    expect(activePublication(list)?.id).toBe(3);
    expect(sortHistory(list).map((p) => p.number)).toEqual([3, 2, 1]);
    expect(activePublication([])).toBeUndefined();
  });
});
