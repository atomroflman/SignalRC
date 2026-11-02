// Test-only helpers of the opt-in live tests (*live*.test.ts):
//   SIGNALRC_LIVE_URL=http://127.0.0.1:<port> SIGNALRC_TEST_POSTGRES="Host=…;Username=…;Password=…;Database=…"
// Users are anonymous session users like the website creates them
// (GET /api/user/me); vehicle control is acquired through a fake onboard
// (JSON protocol), as the overlay administrator role requires (D73).
import { execFileSync } from "node:child_process";
import * as signalR from "@microsoft/signalr";
import type { Fetch } from "../editor/persistence/http";

export const LIVE_BASE = process.env.SIGNALRC_LIVE_URL;
const PG = process.env.SIGNALRC_TEST_POSTGRES;
export const liveEnabled = !!LIVE_BASE && !!PG;

export function sql(query: string): string {
  const kv = Object.fromEntries(PG!.split(";").filter(Boolean).map((p) => p.split("=").map((s) => s.trim()) as [string, string]));
  return execFileSync("psql", ["-h", kv.Host, "-U", kv.Username, "-d", kv.Database, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], {
    env: { ...process.env, PGPASSWORD: kv.Password },
  }).toString().trim();
}

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await wait(20);
  }
  return cond();
}

export function liveHub(cookie?: string, level = signalR.LogLevel.Error) {
  return new signalR.HubConnectionBuilder()
    .withUrl(`${LIVE_BASE}/hubs/connection`, cookie ? { headers: { Cookie: cookie } } : {})
    .configureLogging(level)
    .build();
}

export interface BrowserSession {
  jar: { cookie: string };
  /** fetch with the cookie jar of this browser session. */
  fetch: Fetch;
  /** Id of the anonymous session user, after open(). */
  userId?: number;
  /** GET /api/user/me: creates the anonymous session user and its cookie. */
  open(): Promise<number>;
}

export function browserSession(): BrowserSession {
  const jar = { cookie: "" };
  const f: Fetch = async (input, init = {}) => {
    const headers = new Headers(init.headers);
    if (jar.cookie) headers.set("Cookie", jar.cookie);
    const res = await fetch(input, { ...init, headers });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("SignalRCAuth=")) jar.cookie = c.split(";")[0];
    return res;
  };
  const s: BrowserSession = {
    jar,
    fetch: f,
    async open() {
      const res = await f(`${LIVE_BASE}/api/user/me`);
      if (!res.ok || !jar.cookie) throw new Error(`no session (${res.status})`);
      const me = (await res.json()) as { userId: number; loginName?: string | null };
      if (me.loginName) throw new Error("expected an anonymous session user");
      s.userId = me.userId;
      return me.userId;
    },
  };
  return s;
}

const ONBOARD_NOOPS = ["ApplyChannelMap", "ReleaseCarControl", "SubscribeToTelemetryChannel", "UnsubscribeFromTelemetryChannel", "SetTelemetryDemand"];

/**
 * Fake onboard: registers the vehicle `identityKey` (created by the server if
 * new) and grants every AquireCarControl the session `session`.
 */
export async function fakeOnboard(identityKey: string, session: string, handlers: Record<string, (...args: never[]) => unknown> = {}) {
  const conn = liveHub();
  for (const m of ONBOARD_NOOPS) if (!handlers[m]) conn.on(m, () => {});
  for (const [m, h] of Object.entries(handlers)) conn.on(m, h as (...args: unknown[]) => unknown);
  conn.on("AquireCarControl", () => session);
  await conn.start();
  const config = await conn.invoke("OpenCarConnection", identityKey, "");
  return { conn, carId: config.serverAssignedCarId as number };
}

/** The browser of `user` takes control of the vehicle (driver hub, as the driving view does). */
export async function acquireControl(user: BrowserSession, carId: number) {
  const hub = liveHub(user.jar.cookie);
  hub.on("CarStateUpdated", () => {});
  hub.on("CtlDemand", () => {});
  await hub.start();
  const session = await hub.invoke<string | null>("AquireCarControl", carId, { challenge: "c", signature: "s" });
  if (!session) throw new Error("control not granted");
  return {
    hub,
    session,
    release: () => hub.invoke("ReleaseCarControl", carId, session),
    stop: () => hub.stop(),
  };
}

/**
 * Removes the anonymous session users of a test (Overlay-Abnahme.md B6): only
 * users without LoginName; their setups and stale vehicle marks go with them.
 * Run after the vehicle is deleted (overlay rows cascade with the vehicle).
 */
export function removeSessionUsers(...users: (BrowserSession | undefined)[]) {
  const ids = users.map((u) => u?.userId).filter((id): id is number => id != null);
  if (ids.length === 0) return;
  const list = ids.join(",");
  sql(`delete from "UserSetups" where "UserId" in (${list}); delete from "Users" where "Id" in (${list}) and "LoginName" is null`);
}

/** Removes a test vehicle with its channels and setups (overlay rows cascade). */
export function removeVehicle(carId: number) {
  if (!carId) return;
  sql(`update "Users" set "ActiveVehicleId" = null where "ActiveVehicleId" = ${carId}; delete from "UserSetups" where "CarId" = ${carId}; delete from "CarTelemetry" where "CarId" = ${carId}; delete from "CarChannels" where "CarId" = ${carId}; delete from "Cars" where "Id" = ${carId}`);
}
