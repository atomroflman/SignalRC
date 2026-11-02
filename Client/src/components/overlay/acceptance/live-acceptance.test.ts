// AP14 – cross-cutting acceptance against a locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// The server must use the same database. A fake onboard (JSON protocol)
// registers a vehicle; users, channels and streams are created here and are
// tagged; everything is removed in afterAll (overlay rows cascade with the car).
// Covers what the module tests can only show against doubles: real HTTP,
// headers, permissions, hub groups, reconnect, origin checks and resume.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { HttpOverlayPersistence, type Fetch } from "../editor/persistence/http";
import { OverlayApiError } from "../editor/persistence/types";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { hudConfigFor } from "../integration/hud-config";
import { publishDraft, restorePublication } from "../integration/publish-model";
import { PublishedOverlay, type FetchResponse } from "../integration/published-overlay";
import { SourceHub, type HubLike } from "../sources/hub";
import { contractsRoot } from "../testing/fixtures";

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
async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

/** fetch with the cookie jar of one browser session. */
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

const svgFixture = (name: string) => fs.readFileSync(path.join(contractsRoot, "fixtures/svg/input", name), "utf8");

/**
 * A HubLike over a real connection whose transport can be cut and restored;
 * on restore the onreconnected callbacks run as with automatic reconnect.
 */
class CuttableHub implements HubLike {
  private readonly reconnected: ((id?: string) => void)[] = [];
  constructor(readonly conn: signalR.HubConnection) {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(name: string, handler: (...args: any[]) => void) { this.conn.on(name, handler); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off(name: string, handler: (...args: any[]) => void) { this.conn.off(name, handler); }
  invoke(name: string, ...args: unknown[]) { return this.conn.invoke(name, ...args); }
  onreconnected(cb: (id?: string) => void) { this.reconnected.push(cb); }
  async cut() { await this.conn.stop(); }
  async restore() {
    await this.conn.start();
    for (const cb of this.reconnected) cb(this.conn.connectionId ?? undefined);
  }
}

describe.skipIf(!enabled)("live acceptance (AP14)", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const driver = session();
  const conns: signalR.HubConnection[] = [];
  const disposables: { dispose(): void }[] = [];
  let carId = 0;
  let userId: number | undefined;
  let onboard: signalR.HubConnection;
  let ids: Record<string, number> = {};

  const hub = (cookie?: string) => {
    const h = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE}/hubs/connection`, cookie ? { headers: { Cookie: cookie } } : {})
      .configureLogging(signalR.LogLevel.None)
      .build();
    conns.push(h);
    return h;
  };
  const started = async (cookie?: string) => {
    const h = hub(cookie);
    await h.start();
    return h;
  };
  const api = (rel: string) => `${BASE}/api/cars/${carId}/overlay/${rel}`;
  const anonFetch = (url: string) => fetch(`${BASE}${url}`) as Promise<FetchResponse>;
  const setDriver = (active: boolean) => sql(`update "Users" set "ActiveVehicleId" = ${active ? carId : "null"} where "Id" = ${userId}`);

  const editorTab = async () => {
    const persistence = new HttpOverlayPersistence({ fetch: driver.fetch, baseUrl: BASE, hub: (await started(driver.jar.cookie)) as unknown as HubLike });
    const store = new EditorStore({ carId, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
    const save = new SaveController({ store, persistence, backups: new MemoryBackupStore(), hasControl: true, debounceMs: 50, maxDelayMs: 500 });
    disposables.push(save);
    await save.open();
    await wait(200); // SubscribeToOverlay round trip
    return { persistence, store, save };
  };

  const upload = async (svg: string, f: Fetch = driver.fetch) => {
    const form = new FormData();
    form.append("file", new Blob([svg], { type: "image/svg+xml" }), "a.svg");
    return f(api("assets"), { method: "POST", body: form });
  };

  beforeAll(async () => {
    onboard = hub();
    for (const m of ["ApplyChannelMap", "ReleaseCarControl", "SubscribeToTelemetryChannel", "UnsubscribeFromTelemetryChannel", "SetTelemetryDemand"]) onboard.on(m, () => {});
    onboard.on("AquireCarControl", () => `sess-ap14-${tag}`);
    await onboard.start();
    const config = await onboard.invoke("OpenCarConnection", `ovl-ap14-${tag}`, "");
    carId = config.serverAssignedCarId;
    const rows = sql(`insert into "CarTelemetry" ("CarId","ChannelName","ReadIntervalTicks","TelemetryType","DataType","PinManager","OptionsJson") values
      (${carId},'odoSpeed',1,'x',2,'x',null),(${carId},'odoHeading',1,'x',2,'x',null) returning "Id", "ChannelName"`);
    ids = Object.fromEntries(rows.split("\n").map((r) => { const [id, name] = r.split("|"); return [name, Number(id)]; }));
    const login = await driver.fetch(`${BASE}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: `ovl-ap14-${tag}`, password: `pw-${tag}` }),
    });
    expect(login.status).toBe(200);
    userId = (await login.json()).userId;
    sql(`insert into "UserSetups" ("UserId","CarId") values (${userId}, ${carId})`);
    setDriver(true);
  }, 30_000);

  afterAll(async () => {
    for (const d of disposables) d.dispose();
    for (const c of conns) await c.stop().catch(() => {});
    if (userId) sql(`delete from "UserSetups" where "UserId" = ${userId}`);
    if (carId) sql(`update "Users" set "ActiveVehicleId" = null where "ActiveVehicleId" = ${carId}`);
    if (carId) sql(`delete from "UserSetups" where "CarId" = ${carId}; delete from "CarTelemetry" where "CarId" = ${carId}; delete from "CarChannels" where "CarId" = ${carId}; delete from "Cars" where "Id" = ${carId}`);
    if (userId) sql(`delete from "Users" where "Id" = ${userId}`);
  });

  it("permissions: anonymous viewers read only published state and published assets; management needs the regular active driver (D69, D70)", async () => {
    // Before anything is published: 204, no draft for anonymous.
    expect((await fetch(api("published"))).status).toBe(204);
    for (const [method, rel] of [["GET", "draft"], ["GET", "publications"], ["GET", "dependencies?channel=odoSpeed"]] as const) {
      const r = await fetch(api(rel), { method });
      expect(r.status, rel).toBe(401);
      expect((await r.json()).code).toBe("OVL_API_LOGIN_REQUIRED");
    }
    const anonPut = await fetch(api("draft"), { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": '"0"' }, body: "{}" });
    expect(anonPut.status).toBe(401);
    expect((await upload("<svg xmlns='http://www.w3.org/2000/svg'/>", fetch as unknown as Fetch)).status).toBe(401);
    // Viewer endpoints of an unknown vehicle.
    expect((await fetch(`${BASE}/api/cars/2147483000/overlay/sources`)).status).toBe(404);

    // A pending (unpublished) asset: the driver reads it, an anonymous viewer does not.
    const res = await upload(svgFixture("basic-shapes.svg"));
    expect(res.status).toBe(200);
    const asset = (await res.json()) as { assetId: string };
    expect((await driver.fetch(api(`assets/${asset.assetId}`))).status).toBe(200);
    expect((await fetch(api(`assets/${asset.assetId}`))).status).toBe(404);

    // Not the active driver any more: management is refused per request.
    setDriver(false);
    const r = await driver.fetch(api("draft"));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("OVL_API_NOT_DRIVER");
    setDriver(true);
    expect((await driver.fetch(api("draft"))).status).toBe(200);
  }, 30_000);

  it("SVG upload over HTTP: dangerous files are rejected or cleaned; asset responses are inert (CSP, nosniff, immutable)", async () => {
    for (const name of ["xxe.svg", "billion-laughs.svg", "use-bomb.svg", "use-cycle.svg", "malformed.svg", "not-svg.svg"]) {
      const r = await upload(svgFixture(name));
      expect(r.status, name).toBe(422);
      const body = await r.json();
      expect(body.code, name).toBe("OVL_API_ASSET_REJECTED");
    }
    const tooBig = await upload(`<svg xmlns="http://www.w3.org/2000/svg">${"<!-- x -->".repeat(30_000)}</svg>`);
    expect([413, 422]).toContain(tooBig.status);

    for (const name of ["script-events.svg", "foreign-object.svg", "external-refs.svg", "animations.svg"]) {
      const r = await upload(svgFixture(name));
      expect(r.status, name).toBe(200);
      const { assetId, svg } = (await r.json()) as { assetId: string; svg: string };
      expect(svg, name).not.toMatch(/<script|\son[a-z]+\s*=|javascript:|foreignObject|https?:\/\/(?!www\.w3\.org)|<animate|<set\b|<iframe/i);
      const get = await driver.fetch(api(`assets/${assetId}`));
      expect(get.status).toBe(200);
      expect(get.headers.get("content-type")).toContain("image/svg+xml");
      expect(get.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
      expect(get.headers.get("x-content-type-options")).toBe("nosniff");
      expect(get.headers.get("cache-control")).toContain("immutable");
      expect(await get.text()).toBe(svg);
    }
  }, 30_000);

  it("two tabs: conflict 409 instead of overwrite; control loss 403 keeps editing local; regaining checks the revision", async () => {
    const a = await editorTab();
    const b = await editorTab();
    a.store.dispatch({ type: "replaceDocument", document: { schemaVersion: 1, workspace: { width: 1280, height: 720 }, elements: { e_box: { type: "rect", props: { x: 1 } } }, children: ["e_box"] }, reason: "import" });
    await a.save.flush();
    expect(await until(() => b.save.getState().status === "conflict")).toBe(true);
    // A raw stale write is refused with the current revision.
    const draft = await a.persistence.getDraft(carId);
    const err = await a.persistence.saveDraft(carId, draft.document as OverlayDocument, draft.revision - 1).catch((e) => e);
    expect(err).toBeInstanceOf(OverlayApiError);
    expect(err).toMatchObject({ status: 409, code: "OVL_API_REVISION_CONFLICT", currentRevision: draft.revision });
    await b.save.loadServerState();
    expect(b.store.document.elements.e_box.props!.x).toBe(1);

    setDriver(false);
    a.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 2 });
    expect(await until(() => a.save.getState().status === "localOnly")).toBe(true);
    expect(a.store.document.elements.e_box.props!.x).toBe(2);
    // Meanwhile another tab of a (new) driver saves; regaining control must not overwrite it.
    setDriver(true);
    b.store.dispatch({ type: "setProperty", element: "e_box", property: "x", value: 3 });
    await b.save.flush();
    a.save.setControl(true);
    expect(await until(() => a.save.getState().status === "conflict")).toBe(true);
    expect((await a.persistence.getDraft(carId)).document.elements.e_box.props!.x).toBe(3);
    expect(a.save.backupPackage().document.elements.e_box.props!.x).toBe(2);
  }, 30_000);

  it("publish → open viewer; history keeps its asset; restore changes the HUD only after publishing again; reconnect catches a missed publication", async () => {
    const tab = await editorTab();
    const deps = { carId, save: tab.save, persistence: tab.persistence };
    const asset1 = (await (await upload(svgFixture("basic-shapes.svg"))).json()) as { assetId: string };
    const asset2 = (await (await upload(svgFixture("part-ids.svg"))).json()) as { assetId: string };
    const doc = (x: number, assetId: string): OverlayDocument => ({
      schemaVersion: 1,
      workspace: { width: 1280, height: 720 },
      elements: {
        e_speed: { type: "valueText", props: { x, y: 600, value: { base: null, binding: { expr: 'tel("odoSpeed")' } } } },
        e_logo: { type: "svgAsset", assetId, props: { x: 10, y: 10 } },
      },
      children: ["e_speed", "e_logo"],
    });

    // Anonymous viewer on a connection that can be cut.
    const viewerHub = new CuttableHub(await started());
    const viewer = new PublishedOverlay({ carId, hub: viewerHub, fetch: anonFetch });
    disposables.push(viewer);
    await until(() => viewer.state.status !== "loading");

    tab.store.dispatch({ type: "replaceDocument", document: doc(40, asset1.assetId), reason: "import" });
    const p1 = await publishDraft(deps, "v1");
    expect(p1, JSON.stringify(p1)).toMatchObject({ kind: "published" });
    expect(await until(() => viewer.state.publication?.number === (p1 as { number: number }).number)).toBe(true);
    expect(Object.keys(viewer.state.publication!.assets)).toEqual([asset1.assetId]);
    // Now published, the asset is readable anonymously.
    expect((await fetch(api(`assets/${asset1.assetId}`))).status).toBe(200);

    // Version 2 swaps the asset; many saves push the old revisions out (D35: 50 kept).
    tab.store.dispatch({ type: "replaceDocument", document: doc(300, asset2.assetId), reason: "import" });
    for (let i = 0; i < 55; i++) {
      tab.store.dispatch({ type: "setProperty", element: "e_speed", property: "y", value: 500 + i });
      await tab.save.flush();
    }
    const p2 = await publishDraft(deps, "v2");
    expect(p2).toMatchObject({ kind: "published" });
    const n2 = (p2 as { number: number }).number;
    expect(await until(() => viewer.state.publication?.number === n2)).toBe(true);
    expect(Object.keys(viewer.state.publication!.assets)).toEqual([asset2.assetId]);

    // The historic publication still has its document and asset, also anonymously.
    const p1Id = (p1 as { publicationId: number }).publicationId;
    const hist = await driver.fetch(api(`publications/${p1Id}`));
    expect(hist.status).toBe(200);
    const histBody = await hist.json();
    expect(histBody.document.elements.e_logo.assetId).toBe(asset1.assetId);
    expect(Object.keys(histBody.assets)).toEqual([asset1.assetId]);
    expect((await fetch(api(`assets/${asset1.assetId}`))).status).toBe(200);

    // Restore v1 as draft: published stays v2.
    const restored = await restorePublication(deps, p1Id);
    expect(restored).toMatchObject({ kind: "restored" });
    expect(tab.store.document.elements.e_speed.props!.x).toBe(40);
    const published = await (await fetch(api("published"))).json();
    expect(published.number).toBe(n2);
    expect(viewer.state.publication!.number).toBe(n2);

    // The viewer loses its connection and misses the next publication …
    await viewerHub.cut();
    const p3 = await publishDraft(deps, "v1 again");
    expect(p3).toMatchObject({ kind: "published" });
    await wait(500);
    expect(viewer.state.publication!.number).toBe(n2);
    // … and takes it over after the reconnect, as a whole.
    await viewerHub.restore();
    expect(await until(() => viewer.state.publication?.number === (p3 as { number: number }).number)).toBe(true);
    expect(hudConfigFor(viewer.state.publication, "any")!.elements.e_speed.props.x).toBe(40);
    expect(Object.keys(viewer.state.publication!.assets)).toEqual([asset1.assetId]);
  }, 60_000);

  it("Alt-Onboard text path reaches new clients as unchecked and old clients unchanged; a foreign connection is dropped (D56)", async () => {
    const sources = new SourceHub({
      createConnection: async () => hub() as unknown as HubLike,
      fetchJson: async (url) => {
        const res = await fetch(`${BASE}${url}`);
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      },
    });
    const car = sources.acquire(carId);
    expect(await until(() => car.provider.metadataLoaded && car.provider.isConnected)).toBe(true);
    const req = car.provider.require("hud", [{ kind: "tel", name: "odoSpeed" }]);

    // An old client of the legacy group.
    const old = await started();
    const oldValues: [string, string][] = [];
    old.on("UpdateTelemetry", (name: string, value: string) => { oldValues.push([name, value]); });
    await old.invoke("SubscribeToCarTelemetry", String(carId));
    await wait(300);

    await onboard.invoke("UpdateTelemetry", String(carId), "odoSpeed", "7.5");
    expect(await until(() => req.source.get("tel", "odoSpeed").value === "7.5")).toBe(true);
    expect(req.source.get("tel", "odoSpeed").state).toBe("unchecked");
    expect(await until(() => oldValues.some(([n, v]) => n === "odoSpeed" && v === "7.5"))).toBe(true);

    // A connection that is not the registered onboard of this car is ignored.
    const intruder = await started();
    await intruder.invoke("UpdateTelemetry", String(carId), "odoSpeed", "999");
    await intruder.invoke("UpdateTelemetrySamples", { epoch: "x", seq: 1, ageMs: 0, changed: [{ id: ids.odoSpeed, value: "999", state: 0 }], touched: [], touchedAged: [] });
    await wait(500);
    expect(req.source.get("tel", "odoSpeed").value).toBe("7.5");
    expect(oldValues.some(([, v]) => v === "999")).toBe(false);
    req.release();
    car.release();
  }, 30_000);

  it("driver resume after a reconnect: the new connection publishes the display, the old and foreign ones do not (ResumeCarControl)", async () => {
    const first = await started(driver.jar.cookie);
    first.on("CarStateUpdated", () => {});
    first.on("CtlDemand", () => {});
    const sessionId = await first.invoke<string>("AquireCarControl", carId, { challenge: "c", signature: "s" });
    expect(sessionId).toBe(`sess-ap14-${tag}`);

    const viewer = await started();
    const ctl: unknown[][] = [];
    viewer.on("Ctl", (...args: unknown[]) => { ctl.push(args); });
    viewer.on("CtlCleared", () => {});
    await viewer.invoke("SetControlDisplayInterest", carId, true);

    // The driver's browser reconnects: a new connection with the same session.
    const second = await started(driver.jar.cookie);
    second.on("CarStateUpdated", () => {});
    second.on("CtlDemand", () => {});
    const stranger = await started();
    expect(await stranger.invoke<boolean>("ResumeCarControl", carId, "wrong-session")).toBe(false);
    expect(await second.invoke<boolean>("ResumeCarControl", carId, sessionId)).toBe(true);

    const send = (h: signalR.HubConnection, seq: number, value: number) => h.invoke("Ctl", carId, seq, false, [], [["gear", value]], [], []);
    await send(first, 1, 111);
    await send(stranger, 1, 222);
    await send(second, 1, 3);
    expect(await until(() => ctl.some((m) => JSON.stringify(m).includes('["gear",3]')))).toBe(true);
    await wait(300);
    expect(ctl.some((m) => JSON.stringify(m).includes("111") || JSON.stringify(m).includes("222"))).toBe(false);
    await second.invoke("ReleaseCarControl", carId, sessionId);
    // After the release the session cannot be resumed.
    const third = await started(driver.jar.cookie);
    expect(await third.invoke<boolean>("ResumeCarControl", carId, sessionId)).toBe(false);
    setDriver(true);
  }, 30_000);
});
