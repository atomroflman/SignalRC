import { describe, expect, it } from "vitest";
import { integrationMessages } from "./messages";
import { confirmationText, dependencyWarning, loadChannelDependencies } from "./channel-dependencies";
import { hudVisibilityKey, isHudHidden, setHudHidden } from "./hud-visibility";
import { showsPausedControl } from "./hud-config";
import type { ElementFrame, FrameResult } from "../runtime/types";
import { messagesByLocale } from "@/i18n/translations";
import { lidarSourceMessages } from "../lidar-source/messages";
import { assetMessages } from "../assets/messages";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

describe("personal HUD visibility (browser-local per vehicle)", () => {
  it("is shown without a stored choice and remembers hiding per vehicle", () => {
    const s = memoryStorage();
    expect(isHudHidden(1, s)).toBe(false);
    setHudHidden(1, true, s);
    expect(isHudHidden(1, s)).toBe(true);
    expect(isHudHidden(2, s)).toBe(false);
    setHudHidden(1, false, s);
    expect(s.data.has(hudVisibilityKey(1))).toBe(false);
  });

  it("survives blocked storage", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => {} };
    expect(isHudHidden(1, broken)).toBe(false);
    expect(() => setHudHidden(1, true, broken)).not.toThrow();
  });
});

describe("channel management warnings (AP02 dependencies)", () => {
  const m = integrationMessages.de.channels;
  const res = (status: number, body?: unknown) => async () => ({ ok: status === 200, status, json: async () => body });

  it("counts uses in the published HUD and the draft", async () => {
    const r = await loadChannelDependencies(3, "odo speed", async (url) => {
      expect(url).toBe("/api/cars/3/overlay/dependencies?channel=odo%20speed");
      return res(200, { draft: [{ kind: "telemetry", location: {} }], published: [{}, {}] })();
    });
    expect(r).toEqual({ checked: true, draft: 1, published: 2 });
    const lines = dependencyWarning(r, "odo speed", m);
    expect(lines[0]).toContain("odo speed");
    expect(lines).toContain(`• ${m.inPublished(2)}`);
    expect(lines).toContain(`• ${m.inDraft(1)}`);
    expect(confirmationText("Delete?", lines, m)).toBe(`Delete?\n\n${lines.join("\n")}\n\n${m.proceed}`);
  });

  it("asks plainly when the HUD does not use the channel", async () => {
    const r = await loadChannelDependencies(3, "x", res(200, { draft: [], published: [] }));
    expect(dependencyWarning(r, "x", m)).toEqual([]);
    expect(confirmationText("Delete?", [], m)).toBe("Delete?");
  });

  it("says so when the dependencies could not be checked (no active control, offline)", async () => {
    const denied = await loadChannelDependencies(3, "x", res(403));
    expect(denied).toEqual({ checked: false, status: 403 });
    expect(dependencyWarning(denied, "x", m)).toEqual([m.notChecked]);
    const offline = await loadChannelDependencies(3, "x", async () => { throw new Error("offline"); });
    expect(offline.checked).toBe(false);
  });
});

describe("pause display (D09)", () => {
  const el = (e: Partial<ElementFrame>): ElementFrame => ({ props: {}, markers: {}, parts: {}, hidden: false, ...e });
  const frame = (elements: Record<string, ElementFrame>): FrameResult => ({ t: 0, elements, clips: {}, diagnostics: [] });

  it("is shown when a displayed element, property or part carries the pause marker", () => {
    expect(showsPausedControl(frame({ a: el({}) }))).toBe(false);
    expect(showsPausedControl(frame({ a: el({ marker: "paused" }) }))).toBe(true);
    expect(showsPausedControl(frame({ a: el({ marker: "invalid", markers: { rotation: "paused" } }) }))).toBe(true);
    expect(showsPausedControl(frame({ a: el({ parts: { p: { props: {}, markers: { fill: "paused" } } } }) }))).toBe(true);
    expect(showsPausedControl(frame({ a: el({ marker: "paused", hidden: true }) }))).toBe(false);
  });
});

describe("shared translations", () => {
  it("contain the overlay module texts in both languages", () => {
    for (const locale of ["de", "en"] as const) {
      const o = messagesByLocale[locale].overlay;
      expect(o.hud).toEqual(integrationMessages[locale].hud);
      expect(o.lidarSource).toBe(lidarSourceMessages[locale]);
      expect(o.assets).toBe(assetMessages[locale]);
    }
    expect(Object.keys(integrationMessages.en.hud.problem).sort()).toEqual(Object.keys(integrationMessages.de.hud.problem).sort());
  });
});
