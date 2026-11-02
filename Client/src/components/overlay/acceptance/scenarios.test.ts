// AP14 – cross-module scenarios (Overlay-Arbeitspakete.md AP14, Overlay-Feature.md
// „Berechtigungen und Bearbeitungsablauf“, „Veröffentlichung und Versionsverlauf“).
// Chains of real modules: EditorStore → SaveController → publish model →
// in-memory server → PublishedOverlay (viewer) → hudConfigFor → runtime.
// The server is the AP02 port double; the HTTP/hub path itself is covered by
// the opt-in live tests (live-acceptance.test.ts).
import { describe, expect, it } from "vitest";
import type { OverlayDocument } from "../document/types";
import { parsePackage, serializePackage } from "../exchange/package";
import { commitImport, evaluateImport, prepareImport, suggestMapping, type AssetUploader } from "../exchange/import";
import { publishDraft, restorePublication } from "../integration/publish-model";
import { readContractJson } from "../testing/fixtures";
import { assetId, frameOf, settle, svgOf, World, writes } from "./helpers";

const setSpeedX = (w: { store: { dispatch: (c: never) => unknown } }, x: number) =>
  w.store.dispatch({ type: "setProperty", element: "e_speed", property: "x", value: x } as never);

describe("two tabs and control change while editing", () => {
  it("tab B goes into conflict when tab A saves; server wins; B's state stays downloadable and importable as draft", async () => {
    const world = new World();
    const a = await world.tab({ sessionId: "A" });
    const b = await world.tab({ sessionId: "B" });
    setSpeedX(a, 100);
    setSpeedX(b, 200);
    await a.save.flush();
    await settle();
    expect(b.save.getState().status).toBe("conflict");
    // No silent overwrite: B never wrote.
    expect(world.server.document.elements.e_speed.props!.x).toBe(100);
    const bWrites = world.server.log.filter((l) => l.body && (l.body as OverlayDocument).elements?.e_speed?.props?.x === 200);
    expect(bWrites).toEqual([]);

    // The conflict download is a full exchange package (D34) …
    const text = serializePackage(b.save.backupPackage());
    const parsed = parsePackage(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.package.kind).toBe("backup");
    // … server wins in the editor …
    await b.save.loadServerState();
    expect(b.store.document.elements.e_speed.props!.x).toBe(100);
    // … and the backup can be imported again as a draft (one undo step), never published by that.
    const upload: AssetUploader = async () => { throw new Error("no assets in this package"); };
    const prepared = await prepareImport(parsed.package, upload);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const target = { telemetry: [{ name: "odoSpeed", dataType: "Number" }], outputs: [], streams: [] };
    const evaluation = evaluateImport(prepared.import, suggestMapping(prepared.import, target), target);
    expect(evaluation.canSave).toBe(true);
    const publicationsBefore = world.server.publications.length;
    expect(commitImport(b.store, evaluation).ok).toBe(true);
    expect(b.store.document.elements.e_speed.props!.x).toBe(200);
    await b.save.flush();
    expect(world.server.document.elements.e_speed.props!.x).toBe(200);
    expect(world.server.publications.length).toBe(publicationsBefore);
  });

  it("losing control mid-edit: editing goes on locally without requests; another driver saves; regaining shows a conflict, not an overwrite", async () => {
    const world = new World();
    const a = await world.tab({ sessionId: "A" });
    setSpeedX(a, 10);
    await a.save.flush();
    const rev = a.save.getState().baseRevision!;

    // Control passes to another driver (server-side and announced to the app).
    world.server.driver = false;
    a.save.setControl(false);
    const logBefore = world.server.log.length;
    setSpeedX(a, 11);
    setSpeedX(a, 12);
    a.clock.advance(60_000);
    await settle();
    expect(world.server.log.length).toBe(logBefore);
    expect(a.save.getState()).toMatchObject({ hasControl: false, dirty: true });
    // Publishing from the local state is impossible as well.
    expect(await publishDraft({ carId: world.carId, save: a.save, persistence: world.server.client() }, "")).toMatchObject({ kind: expect.not.stringMatching("published") });
    expect(world.server.publications).toEqual([]);

    // The other driver continues the shared draft.
    world.server.driver = true;
    const other = await world.tab({ sessionId: "other" });
    setSpeedX(other, 50);
    await other.save.flush();
    expect(world.server.revision).toBe(rev + 1);

    // Back in control: the revision is checked first; the newer server state wins.
    a.save.setControl(true);
    await settle();
    expect(a.save.getState().status).toBe("conflict");
    expect(world.server.document.elements.e_speed.props!.x).toBe(50);
    // The local work is not lost: it is in a browser backup and the download.
    expect(a.save.backupPackage().document.elements.e_speed.props!.x).toBe(12);
    await a.save.flushBackup();
    expect(world.backups.entries.some((e) => e.package.document.elements.e_speed?.props?.x === 12)).toBe(true);
  });
});

describe("local restore after reload", () => {
  it("is offered to continue only with an unchanged base revision; otherwise only as download", async () => {
    const world = new World();
    const a = await world.tab({ sessionId: "A" });
    // Connection problems: the change stays local and goes into the backup.
    world.server.failNext("network");
    setSpeedX(a, 77);
    a.clock.advance(3000);
    await settle();
    await a.save.flushBackup();
    a.save.dispose();

    // "Reload": a new tab with the same browser storage, revision unchanged.
    const reloaded = await world.tab({ sessionId: "A2" });
    const offer = reloaded.save.getState().backups.find((o) => o.entry.package.document.elements.e_speed?.props?.x === 77);
    expect(offer?.canContinue).toBe(true);
    expect(reloaded.save.continueFromBackup(offer!.entry)).toBe(true);
    await reloaded.save.flush();
    expect(world.server.document.elements.e_speed.props!.x).toBe(77);

    // Someone saved meanwhile: the same kind of backup is download-only.
    world.server.failNext("network");
    setSpeedX(reloaded, 88);
    reloaded.clock.advance(3000);
    await settle();
    await reloaded.save.flushBackup();
    reloaded.save.dispose();
    world.server.externalSave({ ...world.server.document, workspace: { width: 1280, height: 720 } });
    const later = await world.tab({ sessionId: "A3" });
    const stale = later.save.getState().backups.find((o) => o.entry.package.document.elements.e_speed?.props?.x === 88);
    expect(stale).toBeDefined();
    expect(stale!.canContinue).toBe(false);
    expect(later.save.continueFromBackup(stale!.entry)).toBe(false);
    // Never silently discarded.
    expect(world.backups.entries.some((e) => e.package.document.elements.e_speed?.props?.x === 88)).toBe(true);
  });
});

describe("publish, viewers, restore and immutable assets", () => {
  it("a published state reaches an open viewer as a whole; restore changes the HUD only after publishing again", async () => {
    const world = new World();
    world.addAsset(assetId(1), svgOf("one"));
    world.addAsset(assetId(2), svgOf("two"));
    const viewer = world.viewer();
    await settle();
    expect(viewer.overlay.state.status).toBe("none");

    const editor = await world.tab();
    const deps = { carId: world.carId, save: editor.save, persistence: world.server.client() };
    // Version 1: value at x=40 plus asset 1.
    editor.store.dispatch({ type: "addElements", elements: { e_logo: { type: "svgAsset", assetId: assetId(1), props: { x: 0, y: 0 } } }, roots: ["e_logo"] } as never);
    const p1 = await publishDraft(deps, "v1");
    expect(p1.kind).toBe("published");
    await settle();
    const v1 = viewer.overlay.state.publication!;
    expect(v1.number).toBe(1);
    expect(Object.keys(v1.assets)).toEqual([assetId(1)]);
    expect(frameOf(v1, "any", { odoSpeed: "12.5" })!.elements.e_speed.props.value).toBe(12.5);

    // Version 2: moved and asset swapped.
    setSpeedX(editor, 300);
    expect(editor.store.dispatch({ type: "setAttribute", element: "e_logo", name: "assetId", value: assetId(2) }).ok).toBe(true);
    const p2 = await publishDraft(deps, "v2");
    expect(p2.kind).toBe("published");
    await settle();
    const v2 = viewer.overlay.state.publication!;
    expect(v2.number).toBe(2);
    // No mixed state: document and assets of version 2 only.
    expect(Object.keys(v2.assets)).toEqual([assetId(2)]);
    expect(frameOf(v2, "any")!.elements.e_speed.props.x).toBe(300);

    // Historic publication 1 keeps its asset: still readable by viewers after the draft dropped it.
    const historic = await world.fetch(`/api/cars/${world.carId}/overlay/assets/${assetId(1)}`);
    expect(historic.status).toBe(200);
    expect(await historic.text()).toBe(svgOf("one"));
    expect(world.publicationAssets.get(101)).toEqual([assetId(1)]);

    // Restore version 1 as draft: the shown HUD stays version 2.
    const restored = await restorePublication(deps, 101);
    expect(restored.kind).toBe("restored");
    await settle();
    expect(editor.store.document.elements.e_speed.props!.x).toBe(40);
    expect(viewer.overlay.state.publication!.number).toBe(2);
    expect(frameOf(viewer.overlay.state.publication, "any")!.elements.e_speed.props.x).toBe(300);
    // Publishing again activates it as a new, third publication; history is unchanged.
    const requestsBefore = world.viewerRequests.length;
    const p3 = await publishDraft(deps, "back to v1");
    expect(p3.kind).toBe("published");
    await settle();
    const v3 = viewer.overlay.state.publication!;
    expect(v3.number).toBe(3);
    expect(frameOf(v3, "any")!.elements.e_speed.props.x).toBe(40);
    // Content-addressed asset 1 comes from the cache, not again over the network.
    expect(world.viewerRequests.slice(requestsBefore).filter((u) => u.includes("/assets/"))).toEqual([]);
    expect(world.server.publications.map((p) => p.document.elements.e_speed.props!.x)).toEqual([40, 300, 40]);
    viewer.overlay.dispose();
  });

  it("missed publication during a SignalR outage is taken over after the reconnect", async () => {
    const world = new World();
    const viewer = world.viewer();
    const editor = await world.tab();
    const deps = { carId: world.carId, save: editor.save, persistence: world.server.client() };
    await publishDraft(deps, "");
    await settle();
    expect(viewer.overlay.state.publication?.number).toBe(1);

    viewer.disconnect();
    setSpeedX(editor, 500);
    await publishDraft(deps, "");
    await settle();
    // The event was missed: still version 1, still a complete state.
    expect(viewer.overlay.state.publication?.number).toBe(1);
    viewer.reconnect();
    await settle();
    expect(viewer.hub.calls("SubscribeToOverlay").length).toBe(2);
    expect(viewer.overlay.state.publication?.number).toBe(2);
    expect(frameOf(viewer.overlay.state.publication, "x")!.elements.e_speed.props.x).toBe(500);
    viewer.overlay.dispose();
  });
});

describe("faulty configuration and unknown schema", () => {
  const unknown = readContractJson<unknown>("fixtures/documents/invalid-schema/unknown-schema-version.json");
  const cycle = readContractJson<unknown>("fixtures/documents/invalid-semantic/group-cycle.json");

  it("an unusable newer publication never replaces the running one; without any usable state the HUD stays off", async () => {
    const world = new World();
    world.addAsset(assetId(1), svgOf("one"));
    const editor = await world.tab();
    await publishDraft({ carId: world.carId, save: editor.save, persistence: world.server.client() }, "");
    const viewer = world.viewer();
    await settle();
    expect(viewer.overlay.state.publication?.number).toBe(1);

    // Publications the server could not have produced (another server version, a corrupt row) …
    const push = (document: unknown) => {
      const number = world.server.publications.length + 1;
      world.server.publications.push({ id: 100 + number, number, publishedAt: "", document: document as OverlayDocument });
      world.server.emit({ type: "published", carId: world.carId, publicationId: 100 + number, number });
    };
    push(unknown);
    await settle();
    expect(viewer.overlay.state).toMatchObject({ status: "ready", problem: "unsupported", publication: { number: 1 } });
    push(cycle);
    await settle();
    expect(viewer.overlay.state).toMatchObject({ status: "ready", problem: "invalid", publication: { number: 1 } });
    // … or one with an asset nobody can load: still version 1, retried later.
    const missingAsset = JSON.parse(JSON.stringify(world.server.publications[0].document)) as OverlayDocument;
    missingAsset.elements.e_x = { type: "svgAsset", assetId: assetId(99), props: {} } as never;
    missingAsset.children = [...missingAsset.children, "e_x"];
    push(missingAsset);
    await settle();
    expect(viewer.overlay.state).toMatchObject({ status: "ready", problem: "assets", publication: { number: 1 } });
    expect(frameOf(viewer.overlay.state.publication, "s", { odoSpeed: "3" })!.elements.e_speed.props.value).toBe(3);
    viewer.overlay.dispose();

    // A new viewer that only finds an unusable state shows no HUD.
    push(unknown);
    const late = world.viewer();
    await settle();
    expect(late.overlay.state.status).toBe("none");
    expect(frameOf(late.overlay.state.publication, "s")).toBeNull();
    late.overlay.dispose();
  });

  it("the editor does not save a document with an unknown schema version", async () => {
    const world = new World();
    const editor = await world.tab();
    const before = writes(world.server).length;
    const r = editor.store.dispatch({ type: "replaceDocument", document: unknown as OverlayDocument, reason: "import" } as never) as { ok: boolean };
    if (r.ok) {
      editor.clock.advance(60_000);
      await settle();
    }
    expect(writes(world.server).length).toBe(before);
    expect(world.server.document.schemaVersion).toBe(1);
  });
});
