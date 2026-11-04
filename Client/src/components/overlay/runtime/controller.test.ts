// Controller: display sessions (runtime §2), source requirements, frame
// scheduling, DOM patching without re-creation, diagnostics and containment.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { FakeValueSource } from "../sources/testing/fake-value-source";
import type { ChannelMetadata, Dependency, OverlaySourceProvider, RequireOptions } from "../sources/types";
import { OverlayController } from "./controller";
import { OverlayRenderer } from "./overlay-renderer";
import { FakeDocument } from "./testing/fake-dom";
import { TestClock } from "./testing/test-clock";
import type { RuntimeDiagnostic } from "./types";

const blinkDoc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 200, height: 100 },
  sources: { telemetry: { speed: { staleAfterMs: 2000 } } },
  elements: {
    e_warn: { type: "rect", props: { opacity: 0 } },
    e_speed: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("speed")' } } } },
  },
  children: ["e_warn", "e_speed"],
  clips: {
    c_blink: { durationS: 1, repeat: "infinite", trigger: { mode: "auto" }, tracks: [{ element: "e_warn", property: "opacity", keyframes: [{ t: 0, value: 0 }, { t: 1, value: 1 }] }] },
  },
};

/** A provider double that records requirements. */
class RecordingProvider extends FakeValueSource implements OverlaySourceProvider {
  readonly required: { id: string; deps: Dependency[]; options?: RequireOptions }[] = [];
  released = 0;
  meta: Record<string, ChannelMetadata> = {};

  require(id: string, deps: Dependency[], options?: RequireOptions) {
    this.required.push({ id, deps, options });
    return { source: this, release: () => { this.released++; } };
  }

  metadata(name: string) {
    return this.meta[name];
  }
}

function setup(doc: OverlayDocument = blinkDoc, mode: "live" | "preview" | "design" = "live") {
  const dom = new FakeDocument();
  const host = dom.createElementNS("", "g");
  const clock = new TestClock();
  const source = new RecordingProvider();
  source.meta.speed = { id: 1, name: "speed", dataType: "Number", unit: "km/h", decimals: 0 };
  const diagnostics: RuntimeDiagnostic[][] = [];
  const controller = new OverlayController(host, dom, {
    config: effectiveConfig(doc, null), source, clock, mode, locale: "de",
    onDiagnostics: (d) => diagnostics.push(d),
  });
  const opacity = () => host.byAttr("data-ovl-id", "e_warn")[0]?.attr("opacity");
  return { dom, host, clock, source, controller, diagnostics, opacity };
}

describe("display session", () => {
  it("requires the HUD's dependencies with deadline overrides and releases them", () => {
    const { source, controller } = setup();
    expect(source.required).toHaveLength(1);
    expect(source.required[0].deps).toEqual([{ kind: "tel", name: "speed" }]);
    expect(source.required[0].options?.staleAfterMs).toEqual({ speed: 2000 });
    controller.dispose();
    expect(source.released).toBe(1);
  });

  it("runs frames only while shown and restarts without catching up", () => {
    const { clock, controller, opacity, source } = setup();
    clock.frame(0);
    clock.frame(0.5);
    expect(opacity()).toBe("0.5");
    controller.setShown(false);
    expect(clock.listenerCount).toBe(0);
    expect(source.released).toBe(1);
    clock.set(100.25);
    clock.frame();
    expect(opacity()).toBe("0.5");
    controller.setShown(true);
    expect(source.required).toHaveLength(2);
    // The clip restarts with the new session at t = 100.25: no phase carried over.
    clock.frame(100.25);
    expect(opacity()).toBe("0");
    clock.frame(100.5);
    expect(opacity()).toBe("0.25");
  });

  it("design mode renders base values once, without requirements or frames; scrubbing moves one clip", () => {
    const { source, clock, host, controller, opacity } = setup(blinkDoc, "design");
    expect(source.required).toHaveLength(0);
    expect(clock.listenerCount).toBe(0);
    expect(host.byAttr("data-ovl-id")).toHaveLength(2);
    expect(host.textContent).toContain("—");
    controller.update({ scrub: { clipId: "c_blink", tau: 0.75 } });
    expect(opacity()).toBe("0.75");
    controller.update({ mode: "preview", scrub: undefined });
    expect(source.required).toHaveLength(1);
    expect(clock.listenerCount).toBe(1);
  });

  it("event-driven HUDs render only on source changes", () => {
    const doc: OverlayDocument = { ...blinkDoc, clips: {}, elements: { e_speed: blinkDoc.elements.e_speed }, children: ["e_speed"] };
    const { clock, source, host } = setup(doc);
    expect(clock.listenerCount).toBe(1);
    clock.frame(0);
    expect(clock.listenerCount).toBe(0);
    expect(host.textContent).toBe("— km/h");
    source.set("tel", "speed", { state: "valid", value: "42.4" });
    expect(clock.listenerCount).toBe(1);
    clock.frame(0.1);
    expect(host.textContent).toBe("42 km/h");
  });
});

describe("DOM updates", () => {
  it("patches attributes in place; unchanged frames write nothing", () => {
    const { dom, clock, host, source } = setup();
    source.set("tel", "speed", { state: "valid", value: "10" });
    clock.frame(0);
    const node = host.byAttr("data-ovl-id", "e_warn")[0];
    clock.frame(0.5);
    expect(host.byAttr("data-ovl-id", "e_warn")[0]).toBe(node);
    const writes = dom.writes;
    clock.frame(1.75);
    expect(dom.writes - writes).toBe(1);
    const again = dom.writes;
    clock.frame(1.75);
    expect(dom.writes).toBe(again);
  });
});

describe("diagnostics", () => {
  it("reports only on change", () => {
    const doc: OverlayDocument = { ...blinkDoc, elements: { ...blinkDoc.elements, e_bad: { type: "rect", props: { x: { base: 0, binding: { expr: 'tel("speed") / 0' } } } } }, children: [...blinkDoc.children, "e_bad"] };
    const { clock, source, diagnostics } = setup(doc);
    source.set("tel", "speed", { state: "valid", value: "1" });
    clock.frame(0);
    clock.frame(0.1);
    clock.frame(0.2);
    const withError = diagnostics.filter((d) => d.some((x) => x.code === "OVL_EXPR_DIV_ZERO"));
    expect(withError).toHaveLength(1);
    source.set("tel", "speed", { state: "invalid" });
    clock.frame(0.3);
    expect(diagnostics.at(-1)).toEqual([]);
  });
});

describe("OverlayRenderer", () => {
  it("renders the svg frame on the server without touching the DOM", () => {
    const markup = renderToStaticMarkup(createElement(OverlayRenderer, { config: effectiveConfig(blinkDoc, null), mode: "live", locale: "de" }));
    expect(markup).toBe('<svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid meet" style="pointer-events:none" aria-hidden="true" data-ovl-mode="live"><g></g></svg>');
  });
});
