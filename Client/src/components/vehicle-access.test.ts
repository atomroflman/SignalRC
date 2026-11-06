import { describe, expect, it } from "vitest";
import { openConfigSession } from "./vehicle-access";
import { otherFlows, toPreview, type SetupSummary } from "./flow-sharing-panel";

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: Record<string, () => Response>) {
  const calls: Call[] = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const key = `${init?.method ?? "GET"} ${url}`;
    const make = responses[key];
    if (!make) throw new Error(`unexpected ${key}`);
    return make();
  };
  return { f, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("openConfigSession (Docs/VehicleKeyAuth.md)", () => {
  it("signs the server nonce with the stored key and posts it", async () => {
    const { f, calls } = fakeFetch({
      "POST /api/cars/7/config-session/nonce": () => json({ nonce: "n-1" }),
      "POST /api/cars/7/config-session": () => json({ expiresAt: "x" }),
    });
    const signed: string[] = [];
    const result = await openConfigSession(7, {
      privateKey: "KEY",
      sign: async (data, key) => { signed.push(`${data}|${key}`); return "SIG"; },
      fetchImpl: f,
    });
    expect(result).toEqual({ ok: true });
    expect(signed).toEqual(["n-1|KEY"]);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ nonce: "n-1", signature: "SIG" });
  });

  it("needs a stored key and asks the server nothing without one", async () => {
    const { f, calls } = fakeFetch({});
    expect(await openConfigSession(7, { privateKey: null, sign: async () => "SIG", fetchImpl: f })).toEqual({ ok: false, reason: "noKey" });
    expect(calls).toHaveLength(0);
  });

  it("tells a rejected signature from a vehicle without reported key", async () => {
    const rejected = fakeFetch({
      "POST /api/cars/7/config-session/nonce": () => json({ nonce: "n" }),
      "POST /api/cars/7/config-session": () => new Response("no", { status: 403 }),
    });
    expect(await openConfigSession(7, { privateKey: "K", sign: async () => "S", fetchImpl: rejected.f })).toMatchObject({ reason: "signature" });

    const unknown = fakeFetch({
      "POST /api/cars/7/config-session/nonce": () => json({ nonce: "n" }),
      "POST /api/cars/7/config-session": () => new Response("no key", { status: 409 }),
    });
    expect(await openConfigSession(7, { privateKey: "K", sign: async () => "S", fetchImpl: unknown.f })).toMatchObject({ reason: "noOwnerKey" });

    // A key the browser cannot use for signing never reaches the server.
    const unusable = fakeFetch({ "POST /api/cars/7/config-session/nonce": () => json({ nonce: "n" }) });
    expect(await openConfigSession(7, { privateKey: "K", sign: async () => null, fetchImpl: unusable.f })).toMatchObject({ reason: "signature" });
    expect(unusable.calls).toHaveLength(1);
  });
});

describe("flow sharing", () => {
  const list: SetupSummary[] = [
    { setupId: 1, owner: "me", isMine: true, nodeCount: 3, linkCount: 1 },
    { setupId: 2, owner: "bea", isMine: false, nodeCount: 2, linkCount: 1 },
    { setupId: 3, owner: "al", isMine: false, nodeCount: 5, linkCount: 4 },
    { setupId: 4, owner: "empty", isMine: false, nodeCount: 0, linkCount: 0 },
  ];

  it("lists only the other drivers' non-empty flows, largest first", () => {
    expect(otherFlows(list).map(s => s.owner)).toEqual(["al", "bea"]);
  });

  it("turns a server flow into a read-only preview", () => {
    const preview = toPreview({
      nodes: [{ nodeId: 10, label: "Lenkung", position: { x: 1, y: 2 } }, { nodeId: 11 }],
      edges: [{ id: 5, source: 10, target: 11 }],
    });
    expect(preview.nodes.map(n => [n.id, n.data.label, n.position, n.draggable])).toEqual([
      ["10", "Lenkung", { x: 1, y: 2 }, false],
      ["11", "11", { x: 0, y: 0 }, false],
    ]);
    expect(preview.edges).toEqual([{ id: "5", source: "10", target: "11" }]);
  });
});
