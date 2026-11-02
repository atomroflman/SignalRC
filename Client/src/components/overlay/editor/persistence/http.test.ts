// HTTP adapter against a fake fetch: paths, If-Match, problem documents, gzip, hub events.
import { describe, expect, it } from "vitest";
import { HttpOverlayPersistence } from "./http";
import { OverlayApiError } from "./types";

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (c: Call) => Response) {
  const calls: Call[] = [];
  return { calls, fetch: async (url: string, init: RequestInit = {}) => { const c = { url, init }; calls.push(c); return respond(c); } };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const empty = () => ({ schemaVersion: 1 as const, workspace: { width: 1, height: 1 }, elements: {}, children: [] });

describe("HttpOverlayPersistence", () => {
  it("sends If-Match and JSON patch to the AP02 paths", async () => {
    const f = fakeFetch(() => json({ revision: 5 }));
    const p = new HttpOverlayPersistence({ fetch: f.fetch });
    expect(await p.patchDraft(3, [{ op: "remove", path: "/a" }], 4)).toEqual({ revision: 5 });
    expect(f.calls[0].url).toBe("/api/cars/3/overlay/draft");
    expect(f.calls[0].init.method).toBe("PATCH");
    const headers = f.calls[0].init.headers as Record<string, string>;
    expect(headers["If-Match"]).toBe('"4"');
    expect(headers["Content-Type"]).toBe("application/json-patch+json");
  });

  it("maps problem documents and network failures to OverlayApiError", async () => {
    const p = new HttpOverlayPersistence({ fetch: fakeFetch(() => json({ code: "OVL_API_REVISION_CONFLICT", title: "x", currentRevision: 9 }, 409)).fetch });
    const e = await p.saveDraft(1, empty(), 2).catch((x) => x);
    expect(e).toBeInstanceOf(OverlayApiError);
    expect(e).toMatchObject({ status: 409, code: "OVL_API_REVISION_CONFLICT", currentRevision: 9 });
    const down = new HttpOverlayPersistence({ fetch: async () => { throw new TypeError("fetch failed"); } });
    expect(await down.getDraft(1).catch((x) => x)).toMatchObject({ status: 0, isNetwork: true });
  });

  it("compresses large bodies with gzip and returns 204 published as null", async () => {
    const f = fakeFetch((c) => (c.url.endsWith("published") ? new Response(null, { status: 204 }) : json({ revision: 1 })));
    const p = new HttpOverlayPersistence({ fetch: f.fetch, gzipFromBytes: 10 });
    await p.saveDraft(1, empty(), 0);
    expect((f.calls[0].init.headers as Record<string, string>)["Content-Encoding"]).toBe("gzip");
    expect(f.calls[0].init.body).toBeInstanceOf(Uint8Array);
    expect(await p.getPublished(1)).toBeNull();
  });

  it("subscribes to overlay events and re-subscribes after a reconnect", async () => {
    const handlers = new Map<string, (...a: unknown[]) => void>();
    let reconnected: (() => void) | undefined;
    const invoked: unknown[][] = [];
    const hub = {
      on: (n: string, h: (...a: unknown[]) => void) => { handlers.set(n, h); },
      off: (n: string) => { handlers.delete(n); },
      invoke: async (...a: unknown[]) => { invoked.push(a); },
      onreconnected: (cb: () => void) => { reconnected = cb; },
    };
    const p = new HttpOverlayPersistence({ fetch: fakeFetch(() => json({})).fetch, hub });
    const events: unknown[] = [];
    const stop = p.onEvent(4, (e) => events.push(e));
    expect(invoked).toEqual([["SubscribeToOverlay", 4]]);
    handlers.get("OverlayDraftChanged")!({ carId: 4, revision: 2 });
    handlers.get("OverlayDraftChanged")!({ carId: 5, revision: 9 });
    reconnected!();
    await new Promise((r) => setImmediate(r));
    expect(invoked).toHaveLength(2);
    expect(events).toEqual([{ type: "draftChanged", carId: 4, revision: 2 }, { type: "reconnected", carId: 4 }]);
    stop();
    expect(handlers.size).toBe(0);
  });
});
