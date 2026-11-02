// Earliest integration proof of AP13 (Overlay-Arbeitspakete.md, M2) against a
// locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// A number and a rotation are edited through editor commands, autosaved and
// published through the editor page logic; a second, already open client takes
// the publication over by OverlayPublished on its existing connection; after
// losing control the server refuses saving. The driver is an anonymous session
// user who took control of a fake onboard's vehicle (D73), exactly as on the
// website; a second anonymous user may not manage. Everything created is
// tagged and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import type { OverlayDocument } from "../document/types";
import { withBase } from "../editor/core/commands";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { HttpOverlayPersistence } from "../editor/persistence/http";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { readContractJson } from "../testing/fixtures";
import { acquireControl, browserSession, fakeOnboard, LIVE_BASE as BASE, liveEnabled as enabled, liveHub, removeSessionUsers, removeVehicle, sql, until } from "../testing/live";
import { hudConfigFor } from "./hud-config";
import { publishDraft } from "./publish-model";
import { PublishedOverlay, type FetchResponse } from "./published-overlay";

describe.skipIf(!enabled)("live server: editor → publish → second client → control loss", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const driver = browserSession();
  const other = browserSession();
  const hubs: signalR.HubConnection[] = [];
  let carId = 0;
  let save: SaveController | undefined;
  let viewer: PublishedOverlay | undefined;
  let control: Awaited<ReturnType<typeof acquireControl>> | undefined;

  const hub = async (cookie?: string) => {
    const h = liveHub(cookie);
    await h.start();
    hubs.push(h);
    return h;
  };

  beforeAll(async () => {
    const onboard = await fakeOnboard(`ovl-ap13-${tag}`, `sess-ap13-${tag}`);
    hubs.push(onboard.conn);
    carId = onboard.carId;
    // The channels the M2 document binds (DataType 2 = Number); publishing checks them.
    sql(`insert into "CarTelemetry" ("CarId","ChannelName","ReadIntervalTicks","TelemetryType","DataType","PinManager","OptionsJson") values
      (${carId},'odoSpeed',1,'x',2,'x',null),(${carId},'odoHeading',1,'x',2,'x',null)`);
    await driver.open();
    await other.open();
    control = await acquireControl(driver, carId);
    hubs.push(control.hub);
  });

  afterAll(async () => {
    save?.dispose();
    viewer?.dispose();
    for (const h of hubs) await h.stop().catch(() => {});
    removeVehicle(carId);
    removeSessionUsers(driver, other);
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

    // An SVG through the real sanitizer: GET draft carries its stored metadata for the editor.
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><g id="needle"><rect width="2" height="10" fill="red"/></g></svg>';
    const upload = await persistence.uploadAsset(carId, new Blob([svg], { type: "image/svg+xml" }));
    store.dispatch({ type: "addElements", elements: { e_svg: { type: "svgAsset", assetId: upload.assetId, props: { x: 10, y: 10 } } }, roots: ["e_svg"] });
    expect(await until(() => save!.getState().status === "saved" && !save!.getState().dirty)).toBe(true);
    const withAsset = await persistence.getDraft(carId);
    expect(withAsset.assets?.[upload.assetId]).toEqual(upload.metadata);

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

    // Another anonymous session user (no control) may neither read the draft nor publish.
    const foreignDraft = await other.fetch(`${BASE}/api/cars/${carId}/overlay/draft`);
    expect(foreignDraft.status).toBe(403);
    expect((await foreignDraft.json()).code).toBe("OVL_API_NOT_DRIVER");
    const foreignPublish = await other.fetch(`${BASE}/api/cars/${carId}/overlay/publications`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: save.getState().baseRevision }),
    });
    expect(foreignPublish.status).toBe(403);

    // Control loss (ReleaseCarControl): the server refuses saving; the editor keeps the local change.
    await control!.release();
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
