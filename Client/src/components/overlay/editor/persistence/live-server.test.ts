// Integration test of the HTTP persistence adapter and the autosave against a
// locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// Creates its own user and vehicle (tagged) and removes them afterwards.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import type { OverlayDocument } from "../../document/types";
import { EditorStore } from "../core/store";
import { SaveController } from "./autosave";
import { HttpOverlayPersistence, type Fetch } from "./http";
import { OverlayApiError } from "./types";

const BASE = process.env.SIGNALRC_LIVE_URL;
const PG = process.env.SIGNALRC_TEST_POSTGRES;
const enabled = !!BASE && !!PG;

function sql(query: string): string {
  const kv = Object.fromEntries(PG!.split(";").filter(Boolean).map((p) => p.split("=").map((s) => s.trim()) as [string, string]));
  return execFileSync("psql", ["-h", kv.Host, "-U", kv.Username, "-d", kv.Database, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    env: { ...process.env, PGPASSWORD: kv.Password },
  }).toString().trim();
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

/** fetch with a cookie jar of one browser session. */
function session() {
  const jar = { cookie: "" };
  const f: Fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (jar.cookie) headers.set("Cookie", jar.cookie);
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("SignalRCAuth=")) jar.cookie = c.split(";")[0];
    return res;
  };
  return { jar, fetch: f };
}

describe.skipIf(!enabled)("live server: HTTP persistence and autosave", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const driver = session();
  const hubs: signalR.HubConnection[] = [];
  const controllers: SaveController[] = [];
  let carId = 0;
  let userId: number | undefined;

  const hub = async () => {
    const h = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE}/hubs/connection`, { headers: { Cookie: driver.jar.cookie } })
      .configureLogging(signalR.LogLevel.Error)
      .build();
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
    const login = await driver.fetch(`${BASE}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: `ovl-ap09-${tag}`, password: `pw-${tag}` }),
    });
    expect(login.status).toBe(200);
    userId = (await login.json()).userId;
    carId = Number(sql(`insert into "Cars" ("Name","CarIdentityKey","ChannelMapHash","LastSeen") values ('ovl-ap09-${tag}','ovl-ap09-${tag}','',now()) returning "Id"`).split("\n")[0]);
    sql(`insert into "UserSetups" ("UserId","CarId") values (${userId}, ${carId})`);
    sql(`update "Users" set "ActiveVehicleId" = ${carId} where "Id" = ${userId}`);
  });

  afterAll(async () => {
    for (const c of controllers) c.dispose();
    for (const h of hubs) await h.stop().catch(() => {});
    // Overlay rows of the vehicle are removed with it (cascade).
    if (userId) sql(`delete from "UserSetups" where "UserId" = ${userId}`);
    if (carId) sql(`update "Users" set "ActiveVehicleId" = null where "ActiveVehicleId" = ${carId}`);
    if (carId) sql(`delete from "Cars" where "Id" = ${carId}`);
    if (userId) sql(`delete from "Users" where "Id" = ${userId}`);
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
    sql(`update "Users" set "ActiveVehicleId" = null where "Id" = ${userId}`);
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 7 });
    await until(() => a.save.getState().status === "localOnly");
    expect(a.save.getState()).toMatchObject({ status: "localOnly", hasControl: false, error: { code: "OVL_API_NOT_DRIVER" } });
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 8 });
    sql(`update "Users" set "ActiveVehicleId" = ${carId} where "Id" = ${userId}`);
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
