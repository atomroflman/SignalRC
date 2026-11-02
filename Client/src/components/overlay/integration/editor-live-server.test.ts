// Earliest integration proof of AP13 (Overlay-Arbeitspakete.md, M2) against a
// locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// A number and a rotation are edited through editor commands, autosaved and
// published through the editor page logic; a second, already open client takes
// the publication over by OverlayPublished on its existing connection; after
// losing control the server refuses saving. Everything created is tagged and
// removed afterwards.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import type { OverlayDocument } from "../document/types";
import { withBase } from "../editor/core/commands";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { HttpOverlayPersistence, type Fetch } from "../editor/persistence/http";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { readContractJson } from "../testing/fixtures";
import { hudConfigFor } from "./hud-config";
import { publishDraft } from "./publish-model";
import { PublishedOverlay, type FetchResponse } from "./published-overlay";

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

describe.skipIf(!enabled)("live server: editor → publish → second client → control loss", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const driver = session();
  const hubs: signalR.HubConnection[] = [];
  let carId = 0;
  let userId: number | undefined;
  let save: SaveController | undefined;
  let viewer: PublishedOverlay | undefined;

  const hub = async (cookie?: string) => {
    const h = new signalR.HubConnectionBuilder()
      .withUrl(`${BASE}/hubs/connection`, cookie ? { headers: { Cookie: cookie } } : {})
      .configureLogging(signalR.LogLevel.Error)
      .build();
    await h.start();
    hubs.push(h);
    return h;
  };

  beforeAll(async () => {
    const login = await driver.fetch(`${BASE}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: `ovl-ap13-${tag}`, password: `pw-${tag}` }),
    });
    expect(login.status).toBe(200);
    userId = (await login.json()).userId;
    carId = Number(sql(`insert into "Cars" ("Name","CarIdentityKey","ChannelMapHash","LastSeen") values ('ovl-ap13-${tag}','ovl-ap13-${tag}','',now()) returning "Id"`).split("\n")[0]);
    sql(`insert into "UserSetups" ("UserId","CarId") values (${userId}, ${carId})`);
    // The channels the M2 document binds (DataType 2 = Number); publishing checks them.
    sql(`insert into "CarTelemetry" ("CarId","ChannelName","ReadIntervalTicks","TelemetryType","DataType","PinManager","OptionsJson") values
      (${carId},'odoSpeed',1,'x',2,'x',null),(${carId},'odoHeading',1,'x',2,'x',null)`);
    sql(`update "Users" set "ActiveVehicleId" = ${carId} where "Id" = ${userId}`);
  });

  afterAll(async () => {
    save?.dispose();
    viewer?.dispose();
    for (const h of hubs) await h.stop().catch(() => {});
    // Overlay rows of the vehicle are removed with it (cascade).
    if (userId) sql(`delete from "UserSetups" where "UserId" = ${userId}`);
    if (carId) sql(`update "Users" set "ActiveVehicleId" = null where "ActiveVehicleId" = ${carId}`);
    if (carId) sql(`delete from "CarTelemetry" where "CarId" = ${carId}`);
    if (carId) sql(`delete from "Cars" where "Id" = ${carId}`);
    if (userId) sql(`delete from "Users" where "Id" = ${userId}`);
  });

  it("M2: edit value and rotation, save, publish; the open viewer switches without reconnecting; no saving after control loss", async () => {
    // Second client: anonymous viewer with the published HUD already open (nothing published yet).
    const viewerHub = await hub();
    const viewerConnectionId = viewerHub.connectionId;
    let viewerReconnects = 0;
    viewerHub.onreconnecting(() => viewerReconnects++);
    viewer = new PublishedOverlay({
      carId,
      hub: viewerHub,
      fetch: (url) => fetch(`${BASE}${url}`) as Promise<FetchResponse>,
    });
    expect(await until(() => viewer!.state.status === "none")).toBe(true);

    // Editor of the driver, wired like the editor page (HTTP persistence with hub events).
    const persistence = new HttpOverlayPersistence({ fetch: driver.fetch, baseUrl: BASE, hub: await hub(driver.jar.cookie) });
    const store = new EditorStore({ carId, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
    save = new SaveController({ store, persistence, backups: new MemoryBackupStore(), hasControl: true, debounceMs: 50, maxDelayMs: 500 });
    await save.open();
    expect(save.getState()).toMatchObject({ status: "saved", baseRevision: 0 });

    // Start from the M2 reference (value + rotation), then edit both through commands.
    const m2 = readContractJson<OverlayDocument>("fixtures/documents/valid/m2-value-and-rotation.json");
    expect(store.dispatch({ type: "replaceDocument", document: m2, reason: "import" }).ok).toBe(true);
    expect(store.dispatch({ type: "setProperty", element: "e_speed", property: "decimals", value: 2 }).ok).toBe(true);
    const rotation = withBase(store.document.elements.e_compass.props!.rotation, 15);
    expect(store.dispatch({ type: "setProperty", element: "e_compass", property: "rotation", value: rotation }).ok).toBe(true);
    expect(await until(() => save!.getState().status === "saved" && !save!.getState().dirty)).toBe(true);
    const draft = await persistence.getDraft(carId);
    expect(draft.document.elements.e_speed.props!.decimals).toBe(2);
    expect((draft.document.elements.e_compass.props!.rotation as { base: number }).base).toBe(15);

    // Publish with a note.
    const published = await publishDraft({ carId, save, persistence }, "M2 live");
    expect(published, JSON.stringify(published)).toMatchObject({ kind: "published", number: 1 });

    // The viewer takes it over through OverlayPublished on the same connection.
    expect(await until(() => viewer!.state.publication?.number === 1)).toBe(true);
    const config = hudConfigFor(viewer.state.publication, "front")!;
    expect(config.elements.e_speed.props.decimals).toBe(2);
    expect(config.elements.e_compass.props.rotation).toMatchObject({ base: 15 });
    expect(viewerHub.connectionId).toBe(viewerConnectionId);
    expect(viewerHub.state).toBe(signalR.HubConnectionState.Connected);
    expect(viewerReconnects).toBe(0);

    // History lists the publication with its note.
    const history = await persistence.listPublications(carId);
    expect(history[0]).toMatchObject({ number: 1, note: "M2 live" });

    // Control loss: the server refuses saving; the editor keeps the local change.
    sql(`update "Users" set "ActiveVehicleId" = null where "Id" = ${userId}`);
    store.dispatch({ type: "setProperty", element: "e_speed", property: "decimals", value: 3 });
    expect(await until(() => save!.getState().status === "localOnly")).toBe(true);
    expect(save.getState()).toMatchObject({ hasControl: false, error: { code: "OVL_API_NOT_DRIVER" } });
    expect(store.document.elements.e_speed.props!.decimals).toBe(3);
    const raw = await driver.fetch(`${BASE}/api/cars/${carId}/overlay/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-Match": `"${save.getState().baseRevision}"` },
      body: JSON.stringify(store.document),
    });
    expect(raw.status).toBe(403);
    expect((await raw.json()).code).toBe("OVL_API_NOT_DRIVER");
    expect(await publishDraft({ carId, save, persistence }, "")).toEqual({ kind: "noControl" });
    const serverDraft = (await (await fetch(`${BASE}/api/cars/${carId}/overlay/published`)).json()) as { number: number; document: OverlayDocument };
    expect(serverDraft.number).toBe(1);
    expect(serverDraft.document.elements.e_speed.props!.decimals).toBe(2);
  }, 30_000);
});
