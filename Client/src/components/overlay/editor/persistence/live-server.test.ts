// Integration test of the HTTP persistence adapter and the autosave against a
// locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// An anonymous session user takes control of a fake onboard's vehicle (D73);
// everything is tagged and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as signalR from "@microsoft/signalr";
import type { OverlayDocument } from "../../document/types";
import { acquireControl, browserSession, fakeOnboard, LIVE_BASE as BASE, liveEnabled as enabled, liveHub, removeSessionUsers, removeVehicle, until as untilMs, wait } from "../../testing/live";
import { EditorStore } from "../core/store";
import { SaveController } from "./autosave";
import { HttpOverlayPersistence } from "./http";
import { OverlayApiError } from "./types";

const until = (cond: () => boolean, ms = 4000) => untilMs(cond, ms);

describe.skipIf(!enabled)("live server: HTTP persistence and autosave", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const driver = browserSession();
  const hubs: signalR.HubConnection[] = [];
  const controllers: SaveController[] = [];
  let carId = 0;
  let control: Awaited<ReturnType<typeof acquireControl>> | undefined;

  const hub = async () => {
    const h = liveHub(driver.jar.cookie);
    await h.start();
    hubs.push(h);
    return h;
  };

  const tab = async (gzipFromBytes?: number) => {
    const persistence = new HttpOverlayPersistence({ fetch: driver.fetch, baseUrl: BASE, hub: await hub(), gzipFromBytes });
    const store = new EditorStore({ carId, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
    const save = new SaveController({ store, persistence, debounceMs: 50, maxDelayMs: 500 });
    controllers.push(save);
    await save.open();
    await wait(200); // SubscribeToOverlay round trip
    return { persistence, store, save };
  };

  beforeAll(async () => {
    const onboard = await fakeOnboard(`ovl-ap09-${tag}`, `sess-ap09-${tag}`);
    hubs.push(onboard.conn);
    carId = onboard.carId;
    await driver.open();
    control = await acquireControl(driver, carId);
    hubs.push(control.hub);
  });

  afterAll(async () => {
    for (const c of controllers) c.dispose();
    for (const h of hubs) await h.stop().catch(() => {});
    removeVehicle(carId);
    removeSessionUsers(driver);
  });

  it("loads the start draft, saves by PUT, then PATCH, also gzip-compressed", async () => {
    const a = await tab(1);
    expect(a.save.getState()).toMatchObject({ status: "saved", baseRevision: 0 });
    expect(a.store.document.workspace.width).toBe(1920);
    a.store.dispatch({ type: "addElements", elements: { e_box: { type: "rect", props: { x: 10 } } }, roots: ["e_box"] });
    await until(() => a.save.getState().status === "saved" && a.save.getState().baseRevision === 1);
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 42 });
    await until(() => a.save.getState().baseRevision === 2);
    expect(a.save.getState().status).toBe("saved");
    const draft = await a.persistence.getDraft(carId);
    expect(draft.revision).toBe(2);
    expect(draft.document.elements.e_box.props!.x).toBe(42);
  });

  it("a second tab goes into conflict through OverlayDraftChanged; server wins", async () => {
    const a = await tab();
    const b = await tab();
    const rev = a.save.getState().baseRevision!;
    expect(b.save.getState().baseRevision).toBe(rev);
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "y", value: 5 });
    b.store.dispatch({ type: "setProperty", element: "e_box", property: "y", value: 99 });
    await a.save.flush();
    expect(await until(() => b.save.getState().status === "conflict")).toBe(true);
    expect(b.save.getState().conflictRevision).toBe(rev + 1);
    await wait(300);
    expect((await a.persistence.getDraft(carId)).document.elements.e_box.props!.y).toBe(5);
    expect(b.save.backupPackage().document.elements.e_box.props!.y).toBe(99);
    await b.save.loadServerState();
    expect(b.save.getState()).toMatchObject({ status: "saved", baseRevision: rev + 1 });
    expect(b.store.document.elements.e_box.props!.y).toBe(5);
  });

  it("a stale revision is refused with 409 and currentRevision", async () => {
    const p = new HttpOverlayPersistence({ fetch: driver.fetch, baseUrl: BASE });
    const draft = await p.getDraft(carId);
    const err = await p.saveDraft(carId, draft.document as OverlayDocument, draft.revision - 1).catch((e) => e);
    expect(err).toBeInstanceOf(OverlayApiError);
    expect(err).toMatchObject({ status: 409, code: "OVL_API_REVISION_CONFLICT", currentRevision: draft.revision });
    const bad = await p.patchDraft(carId, [{ op: "remove", path: "/nope" }], draft.revision).catch((e) => e);
    expect(bad).toMatchObject({ status: 422, code: "OVL_API_PATCH_FAILED" });
  });

  it("losing control: 403 NOT_DRIVER keeps editing local; regaining continues with the same revision", async () => {
    const a = await tab();
    await control!.release();
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 7 });
    await until(() => a.save.getState().status === "localOnly");
    expect(a.save.getState()).toMatchObject({ status: "localOnly", hasControl: false, error: { code: "OVL_API_NOT_DRIVER" } });
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 8 });
    control = await acquireControl(driver, carId);
    hubs.push(control.hub);
    a.save.setControl(true);
    await until(() => a.save.getState().status === "saved");
    expect((await a.persistence.getDraft(carId)).document.elements.e_box.props!.x).toBe(8);
  });

  it("restart: a new tab loads the saved state", async () => {
    const c = await tab();
    expect(c.store.document.elements.e_box.props!.x).toBe(8);
    expect(c.store.getState().history.size).toBe(0);
  });
});
