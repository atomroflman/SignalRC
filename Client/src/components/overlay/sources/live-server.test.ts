// Integration test against a locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// The server must use the same database. A fake onboard (JSON protocol)
// registers a vehicle; channels are inserted directly. Everything created
// here is tagged and removed afterwards.
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import { ControlDisplayPublisher } from "./control-display";
import { SourceHub, type HubLike } from "./hub";

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
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

const hub = (cookie?: string) =>
  new signalR.HubConnectionBuilder()
    .withUrl(`${BASE}/hubs/connection`, cookie ? { headers: { Cookie: cookie } } : {})
    .configureLogging(signalR.LogLevel.Error)
    .build();

describe.skipIf(!enabled)("live server", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const conns: signalR.HubConnection[] = [];
  let carId = 0;
  let userId: number | undefined;
  let cookie = "";
  let ids: Record<string, number> = {};
  const demands: number[][] = [];
  let onboard: signalR.HubConnection;
  let seq = 0;
  const send = (changed: { id: number; value: string; state: number; ageMs?: number }[], touched: number[] = []) =>
    onboard.invoke("UpdateTelemetrySamples", { epoch: `e-${tag}`, seq: ++seq, ageMs: 0, changed, touched, touchedAged: [] });

  beforeAll(async () => {
    onboard = hub();
    conns.push(onboard);
    onboard.on("SetTelemetryDemand", (d: number[]) => { demands.push(d); });
    for (const m of ["ApplyChannelMap", "ReleaseCarControl", "SubscribeToTelemetryChannel", "UnsubscribeFromTelemetryChannel"]) onboard.on(m, () => {});
    onboard.on("AquireCarControl", () => "sess-ap05");
    await onboard.start();
    const config = await onboard.invoke("OpenCarConnection", `ovl-ap05-${tag}`, "");
    carId = config.serverAssignedCarId;
    const rows = sql(`insert into "CarTelemetry" ("CarId","ChannelName","ReadIntervalTicks","TelemetryType","DataType","PinManager","OptionsJson") values
      (${carId},'speed',1,'x',2,'x',null),(${carId},'volt',10,'x',2,'x',null),
      (${carId},'lidarGrid',2,'x',4,'x','{"zoneLimitsMm":[400,800,1600,3200,6400]}') returning "Id", "ChannelName"`);
    ids = Object.fromEntries(rows.split("\n").map((r) => { const [id, name] = r.split("|"); return [name, Number(id)]; }));
    const login = await fetch(`${BASE}/api/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userName: `ovl-ap05-${tag}`, password: `pw-${tag}` }),
    });
    cookie = login.headers.getSetCookie().find((c) => c.startsWith("SignalRCAuth="))!.split(";")[0];
    userId = (await login.json()).userId;
  }, 20000);

  afterAll(async () => {
    for (const c of conns) await c.stop().catch(() => {});
    if (userId) sql(`delete from "UserSetups" where "UserId" = ${userId}; delete from "Users" where "Id" = ${userId}`);
    if (carId) sql(`delete from "UserSetups" where "CarId" = ${carId}; delete from "CarTelemetry" where "CarId" = ${carId}; delete from "Cars" where "Id" = ${carId}`);
  });

  const sources = () =>
    new SourceHub({
      createConnection: async () => {
        const c = hub(cookie);
        conns.push(c);
        return c as unknown as HubLike;
      },
      fetchJson: async (url) => {
        const res = await fetch(`${BASE}${url}`, { headers: { Cookie: cookie } });
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      },
    });

  it("unites consumers, ages, survives the release of one consumer", async () => {
    const s = sources();
    const car = s.acquire(carId);
    const p = car.provider;
    expect(await until(() => p.metadataLoaded && p.isConnected)).toBe(true);
    expect(p.metadata("volt")).toMatchObject({ readIntervalTicks: 10, dataType: "Number" });
    expect(p.metadata("lidarGrid")).toMatchObject({ dataType: "LidarGrid", zoneLimitsMm: [400, 800, 1600, 3200, 6400] });

    const bar = p.require("bar", [{ kind: "tel", name: "speed" }]);
    const hudReq = p.require("hud", [{ kind: "tel", name: "volt" }, { kind: "tel", name: "lidarGrid" }]);
    const all = [ids.speed, ids.volt, ids.lidarGrid].sort((a, b) => a - b);
    expect(await until(() => JSON.stringify(demands.at(-1)) === JSON.stringify(all))).toBe(true);

    await send([{ id: ids.speed, value: "12.5", state: 0 }, { id: ids.volt, value: "11.9", state: 1, ageMs: 40 }, { id: ids.lidarGrid, value: "11s:AQBkAA==", state: 0 }]);
    expect(await until(() => bar.source.get("tel", "speed").state === "valid")).toBe(true);
    expect(hudReq.source.get("tel", "volt")).toMatchObject({ state: "unchecked", value: "11.9" });
    expect(hudReq.source.lidarGrid("lidarGrid").grid?.cm[1]).toBe(100);

    hudReq.release();
    expect(await until(() => JSON.stringify(demands.at(-1)) === JSON.stringify([ids.speed]))).toBe(true);
    await send([], [ids.speed]);
    await wait(100);
    expect(bar.source.get("tel", "speed").state).toBe("valid");

    let notified = 0;
    p.subscribe(() => { notified++; });
    // No further messages: the value must turn stale on its own.
    expect(await until(() => bar.source.get("tel", "speed").reason === "stale", 2500)).toBe(true);
    expect(notified).toBeGreaterThan(0);

    car.release();
    expect(await until(() => JSON.stringify(demands.at(-1)) === "[]")).toBe(true);
  }, 15000);

  it("relays the driver's display values to a viewer", async () => {
    const driver = hub(cookie);
    conns.push(driver);
    driver.on("CarStateUpdated", () => {});
    const publisher = new ControlDisplayPublisher(driver as unknown as HubLike, carId);
    await driver.start();
    const session = await driver.invoke("AquireCarControl", carId, { challenge: "c", signature: "s" });
    expect(session).toBe("sess-ap05");
    publisher.setSignal("gear", 2);
    publisher.setOutput(5, 0.5);
    publisher.setPaused(true);

    const s = sources();
    const car = s.acquire(carId);
    const req = car.provider.require("hud", [{ kind: "sig", name: "gear" }]);
    expect(await until(() => publisher.demanded)).toBe(true);
    expect(await until(() => req.source.get("sig", "gear").state === "valid")).toBe(true);
    expect(req.source.get("sig", "gear")).toMatchObject({ value: 2, paused: true });
    publisher.setSignal("gear", 3);
    expect(await until(() => req.source.get("sig", "gear").value === 3)).toBe(true);
    // Keepalives keep it fresh beyond the 1 s deadline.
    await wait(1500);
    expect(req.source.get("sig", "gear").state).toBe("valid");

    req.release();
    expect(await until(() => !publisher.demanded)).toBe(true);
    const req2 = car.provider.require("hud", [{ kind: "sig", name: "gear" }]);
    expect(await until(() => req2.source.get("sig", "gear").value === 3)).toBe(true);
    await driver.invoke("ReleaseCarControl", carId, session);
    publisher.controlEnded();
    expect(await until(() => req2.source.get("sig", "gear").state === "invalid")).toBe(true);
    publisher.dispose();
    car.release();
  }, 15000);
});
