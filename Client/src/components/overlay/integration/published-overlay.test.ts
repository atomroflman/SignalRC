import { describe, expect, it } from "vitest";
import { readContractJson } from "../testing/fixtures";
import { FakeHub } from "../sources/testing/fake-hub";
import { ManualClock } from "../sources/testing/manual-clock";
import { flush } from "../sources/testing/setup";
import type { OverlayDocument } from "../document";
import { PublishedOverlay, RETRY_MS, documentAssetIds, type FetchResponse } from "./published-overlay";
import { hudConfigFor } from "./hud-config";

const m2 = readContractJson<OverlayDocument>("fixtures/documents/valid/m2-value-and-rotation.json");
const withAsset = readContractJson<OverlayDocument>("fixtures/documents/valid/variants-clips-lidar.json");
const unsupported = readContractJson<unknown>("fixtures/documents/invalid-schema/unknown-schema-version.json");
const cycle = readContractJson<unknown>("fixtures/documents/invalid-semantic/group-cycle.json");
const ASSET = "sha256-0000000000000000000000000000000000000000000000000000000000000001";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

type Answer = { status: number; body?: unknown } | Error | (() => Promise<{ status: number; body?: unknown }>);

function respond(a: { status: number; body?: unknown }): FetchResponse {
  return {
    status: a.status,
    ok: a.status >= 200 && a.status < 300,
    json: async () => a.body,
    text: async () => String(a.body),
  };
}

function setup(carId = 7) {
  const hub = new FakeHub();
  const clock = new ManualClock();
  const routes = new Map<string, Answer>();
  const requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    const a = routes.get(url);
    if (!a) throw new Error(`unexpected ${url}`);
    if (a instanceof Error) throw a;
    return respond(typeof a === "function" ? await a() : a);
  };
  const published = (body: unknown) => routes.set(`/api/cars/${carId}/overlay/published`, { status: 200, body });
  const asset = (status = 200) => routes.set(`/api/cars/${carId}/overlay/assets/${ASSET}`, { status, body: SVG });
  const start = () => new PublishedOverlay({ carId, hub, fetch, clock });
  return { hub, clock, routes, requests, published, asset, start, carId };
}

const publication = (publicationId: number, document: unknown) => ({ publicationId, number: publicationId, publishedAt: "2026-11-02T10:00:00Z", document });

describe("published overlay (api §3 GET published, §4 events)", () => {
  it("joins the vehicle group, loads the publication and is ready", async () => {
    const t = setup();
    t.published(publication(1, m2));
    const o = t.start();
    expect(o.state.status).toBe("loading");
    await flush();
    expect(t.hub.calls("SubscribeToOverlay")).toEqual([[7]]);
    expect(o.state.status).toBe("ready");
    expect(o.state.publication?.publicationId).toBe(1);
    expect(o.state.problem).toBeUndefined();
    expect(hudConfigFor(o.state.publication, "any-stream")?.root.length).toBeGreaterThan(0);
  });

  it("204 means no HUD", async () => {
    const t = setup();
    t.routes.set("/api/cars/7/overlay/published", { status: 204 });
    const o = t.start();
    await flush();
    expect(o.state).toEqual({ status: "none" });
  });

  it("takes over a new publication on OverlayPublished as a whole and ignores other vehicles and the current id", async () => {
    const t = setup();
    t.published(publication(1, m2));
    const o = t.start();
    await flush();
    const first = o.state.publication;
    let changes = 0;
    o.subscribe(() => changes++);

    t.hub.push("OverlayPublished", { carId: 8, publicationId: 2, number: 2 });
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 1, number: 1 });
    await flush();
    expect(t.requests.filter((u) => u.endsWith("/published")).length).toBe(1);

    t.published(publication(2, m2));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 2, number: 2 });
    await flush();
    expect(changes).toBe(1);
    expect(o.state.publication?.publicationId).toBe(2);
    expect(o.state.publication).not.toBe(first);
  });

  it("loads all assets before switching, once per asset id", async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    t.routes.set(`/api/cars/7/overlay/assets/${ASSET}`, async () => {
      await gate;
      return { status: 200, body: SVG };
    });
    t.published(publication(1, m2));
    const o = t.start();
    await flush();
    t.published(publication(2, withAsset));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 2, number: 2 });
    await flush();
    // Still the old publication while the asset loads: no mixed state.
    expect(o.state.publication?.publicationId).toBe(1);
    release();
    await flush();
    expect(o.state.publication?.publicationId).toBe(2);
    expect(o.state.publication?.assets[ASSET]).toEqual({ svg: SVG });

    t.published(publication(3, withAsset));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 3, number: 3 });
    await flush();
    expect(o.state.publication?.publicationId).toBe(3);
    expect(t.requests.filter((u) => u.includes("/assets/")).length).toBe(1);
  });

  it("keeps the running HUD with a hint when the new document is unusable", async () => {
    const t = setup();
    t.published(publication(1, m2));
    const o = t.start();
    await flush();
    const running = o.state.publication;

    t.published(publication(2, unsupported));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 2, number: 2 });
    await flush();
    expect(o.state).toEqual({ status: "ready", publication: running, problem: "unsupported" });

    t.published(publication(3, cycle));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 3, number: 3 });
    await flush();
    expect(o.state).toEqual({ status: "ready", publication: running, problem: "invalid" });
    // Unusable documents are not retried; the next publication brings an event.
    expect(t.clock.pendingTimers).toBe(0);
  });

  it("without a usable state the HUD stays off", async () => {
    const t = setup();
    t.published(publication(1, unsupported));
    const o = t.start();
    await flush();
    expect(o.state).toEqual({ status: "none", problem: "unsupported" });
  });

  it("retries a failed load and a failed asset, keeping what runs", async () => {
    const t = setup();
    t.routes.set("/api/cars/7/overlay/published", new Error("offline"));
    const o = t.start();
    await flush();
    expect(o.state).toEqual({ status: "none", problem: "load" });
    t.published(publication(1, withAsset));
    t.asset(500);
    t.clock.advance(RETRY_MS[0]);
    await flush();
    expect(o.state).toEqual({ status: "none", problem: "assets" });
    t.asset(200);
    t.clock.advance(RETRY_MS[1] - 1);
    await flush();
    expect(o.state.status).toBe("none");
    t.clock.advance(1);
    await flush();
    expect(o.state.status).toBe("ready");
    expect(o.state.problem).toBeUndefined();
    expect(t.clock.pendingTimers).toBe(0);
  });

  it("after a reconnect joins again and compares the publication id", async () => {
    const t = setup();
    t.published(publication(1, m2));
    const o = t.start();
    await flush();
    const running = o.state.publication;

    t.hub.reconnected();
    await flush();
    expect(t.hub.calls("SubscribeToOverlay").length).toBe(2);
    expect(o.state.publication).toBe(running);

    // A publication missed while disconnected is taken over after the next reconnect.
    t.published(publication(2, m2));
    t.hub.reconnected();
    await flush();
    expect(o.state.publication?.publicationId).toBe(2);
  });

  it("an answer of an older request never overwrites a newer one", async () => {
    const t = setup();
    let releaseFirst!: () => void;
    const slow = new Promise<void>((r) => (releaseFirst = r));
    let call = 0;
    t.routes.set("/api/cars/7/overlay/published", async () => {
      call++;
      if (call === 1) {
        await slow;
        return { status: 200, body: publication(1, m2) };
      }
      return { status: 200, body: publication(2, m2) };
    });
    const o = t.start();
    await flush();
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 2, number: 2 });
    await flush();
    releaseFirst();
    await flush();
    // The event during the first request leads to one more request afterwards.
    expect(call).toBe(2);
    expect(o.state.publication?.publicationId).toBe(2);
  });

  it("dispose leaves the group and stops listening", async () => {
    const t = setup();
    t.published(publication(1, m2));
    const o = t.start();
    await flush();
    o.dispose();
    t.published(publication(2, m2));
    t.hub.push("OverlayPublished", { carId: 7, publicationId: 2, number: 2 });
    t.hub.reconnected();
    await flush();
    expect(o.state.publication?.publicationId).toBe(1);
    expect(t.hub.calls("UnsubscribeFromOverlay")).toEqual([[7]]);
  });

  it("collects asset ids of the standard and of all variants", () => {
    expect(documentAssetIds(withAsset)).toEqual([ASSET]);
    const doc = {
      ...m2,
      variants: {
        a: { addedElements: { e_x: { type: "svgAsset", assetId: "sha256-b", props: {} } } },
        b: { elements: { e_speed: { assetId: "sha256-ignored" } } },
      },
    } as unknown as OverlayDocument;
    expect(documentAssetIds(doc)).toEqual(["sha256-b"]);
  });
});

describe("HUD for a stream (variants, D38)", () => {
  it("uses the variant, falls back to the standard without one and shows nothing for a disabled variant", () => {
    const pub = { publicationId: 1, number: 1, document: withAsset, assets: {} };
    expect(hudConfigFor(pub, "rear")).toBeNull();
    expect(hudConfigFor(pub, "front-wide")?.streamId).toBe("front-wide");
    expect(hudConfigFor(pub, "unknown")?.streamId).toBeNull();
    expect(hudConfigFor(undefined, "front-wide")).toBeNull();
    expect(hudConfigFor({ ...pub, document: { ...withAsset, disabled: true } }, "front-wide")).toBeNull();
  });
});
