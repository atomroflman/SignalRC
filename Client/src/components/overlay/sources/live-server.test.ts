// Integration test against a locally started server (opt-in):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// The server must use the same database. A fake onboard (JSON protocol)
// registers a vehicle; channels are inserted directly; the driver is an
// anonymous session user. Everything created here is tagged and removed afterwards.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as signalR from "@microsoft/signalr";
import { ControlDisplayPublisher } from "./control-display";
import { browserSession, LIVE_BASE as BASE, liveEnabled as enabled, removeSessionUsers, removeVehicle, sql, until as untilMs, wait } from "../testing/live";
import { SourceHub, type HubLike } from "./hub";

const until = (cond: () => boolean, ms = 3000) => untilMs(cond, ms);

const hub = (cookie?: string) =>
  new signalR.HubConnectionBuilder()
    .withUrl(`${BASE}/hubs/connection`, cookie ? { headers: { Cookie: cookie } } : {})
    .configureLogging(signalR.LogLevel.Error)
    .build();

describe.skipIf(!enabled)("live server", () => {
  const tag = Math.random().toString(16).slice(2, 12);
  const conns: signalR.HubConnection[] = [];
  let carId = 0;
  const user = browserSession();
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
    await user.open();
    cookie = user.jar.cookie;
  }, 20000);

  afterAll(async () => {
    for (const c of conns) await c.stop().catch(() => {});
    removeVehicle(carId);
    removeSessionUsers(user);
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
    expect(await until(() => notified > 0 && bar.source.get("tel", "speed").reason === "stale", 2500)).toBe(true);
    expect(notified).toBeGreaterThan(0);

    car.release();
    expect(await until(() => JSON.stringify(demands.at(-1)) === "[]")).toBe(true);
  }, 15000);

  it("serves anonymous viewers by the stream permission (D69, D70)", async () => {
    const outputId = Number(sql(`insert into "CarChannels" ("CarId","ChannelName","PinManager","TestDisabled","IsEnabled","RequiresAxis") values (${carId},'steering','x',false,true,false) returning "Id"`).split("\n")[0]);
    const res = await fetch(`${BASE}/api/cars/${carId}/overlay/sources`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outputs).toEqual([{ id: outputId, channelName: "steering" }]);
    expect(body.telemetry.map((t: { channelName: string }) => t.channelName).sort()).toEqual(["lidarGrid", "speed", "volt"]);
    expect(JSON.stringify(body)).not.toContain("subscribed");
    expect((await fetch(`${BASE}/api/cars/2147483000/overlay/sources`)).status).toBe(404);
    // The personal endpoint stays login-only.
    expect((await fetch(`${BASE}/api/car/${carId}/telemetry`)).status).toBe(401);

    const anon = hub();
    conns.push(anon);
    await anon.start();
    await expect(anon.invoke("SetTelemetryInterest", 2147483000, [1])).rejects.toThrow();
    await expect(anon.invoke("SetControlDisplayInterest", 2147483000, true)).rejects.toThrow();
    await anon.invoke("SetTelemetryInterest", 2147483000, []);
    await anon.invoke("SetControlDisplayInterest", 2147483000, false);
    await anon.invoke("SetTelemetryInterest", carId, [ids.speed]);
    expect(await until(() => JSON.stringify(demands.at(-1)) === JSON.stringify([ids.speed]))).toBe(true);
    await anon.invoke("SetTelemetryInterest", carId, []);
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
