// AP14 – simulation without real vehicle commands, across modules (Lieferpunkt 3):
// editor (EditorStore + SaveController on the in-memory server) + preview
// (PreviewSession over the real AP05 provider) + a second live consumer on the
// same provider (the driver/viewer HUD) + the control flow store paused by the
// editor. The simulation must stay inside the preview.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useControlFlowStore } from "../../control-flow-store";
import { effectiveConfig } from "../document";
import type { OverlayDocument } from "../document/types";
import { EditorStore } from "../editor/core/store";
import { SaveController } from "../editor/persistence/autosave";
import { InMemoryOverlayServer } from "../editor/testing/in-memory-persistence";
import { MemoryBackupStore } from "../editor/testing/memory-backup-store";
import { pauseOnEditorOpen, sendState, type PauseStoreLike } from "../integration/editor-control";
import { PreviewSession } from "../preview/session";
import { createRuntime } from "../runtime";
import { OverlayController } from "../runtime/controller";
import { FakeDocument } from "../runtime/testing/fake-dom";
import { TestClock } from "../runtime/testing/test-clock";
import { ManualClock } from "../sources/testing/manual-clock";
import { flush, setupSources } from "../sources/testing/setup";

const READ_ONLY = new Set(["UiClientConnected", "SetTelemetryInterest", "SetControlDisplayInterest", "SubscribeToOverlay", "UnsubscribeFromOverlay"]);

const doc: OverlayDocument = {
  schemaVersion: 1,
  workspace: { width: 400, height: 300 },
  elements: {
    e_speed: { type: "valueText", props: { value: { base: null, binding: { expr: 'tel("speed")' } } } },
    e_steer: { type: "rect", props: { rotation: { base: 0, binding: { expr: 'out("steering") * 45' } } } },
    e_lidar: { type: "lidarWidget", source: "lidarGrid", props: { x: 200, y: 100, width: 100, height: 100 } },
  },
  children: ["e_speed", "e_steer", "e_lidar"],
};

const pauseStore = useControlFlowStore as unknown as PauseStoreLike;
const initialFlow = useControlFlowStore.getState();

describe("simulation stays local across editor, preview and live HUD", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    useControlFlowStore.setState({ ...initialFlow, updatesEnabled: true, isInConfigMode: false, editorPaused: false, carId: 1, carSession: "sess", connection: undefined }, true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useControlFlowStore.setState(initialFlow, true);
  });

  it("simulated values reach only the preview: no hub writes, no commands, no draft change, no persistence call; the live HUD keeps live values", async () => {
    // Control connection of this tab: the editor pauses sending (api §6).
    const controlCalls: unknown[][] = [];
    useControlFlowStore.setState({ connection: { state: "Connected", invoke: vi.fn(async (...a: unknown[]) => { controlCalls.push(a); }) } as never });
    pauseOnEditorOpen(pauseStore);
    expect(sendState(useControlFlowStore.getState(), 1)).toBe("paused");

    // Live sources (AP05) and a second consumer: the HUD another component shows.
    const env = setupSources(
      [{ id: 11, channelName: "speed", readIntervalTicks: 1 }, { id: 13, channelName: "lidarGrid", dataType: "lidargrid", readIntervalTicks: 2 }],
      [{ id: 5, channelName: "steering" }],
    );
    const car = env.sources.acquire(1);
    const provider = car.provider;
    await flush();
    const liveHud = provider.require("hud", [{ kind: "tel", name: "speed" }, { kind: "out", name: "steering" }, { kind: "tel", name: "lidarGrid" }]);
    env.clock.advance(250);
    await flush();
    env.hub.push("Tlm", 1, 1, 0, [[11, "12.5"]], [], []);
    const liveRuntime = createRuntime(effectiveConfig(doc, null), { channels: () => ({ dataType: "Number" }) });

    // The editor with autosave on the shared draft.
    const server = new InMemoryOverlayServer(1);
    server.document = doc;
    server.revision = 4;
    const store = new EditorStore({ carId: 1, document: { schemaVersion: 1, workspace: { width: 1, height: 1 }, elements: {}, children: [] } });
    const save = new SaveController({ store, persistence: server.client(), backups: new MemoryBackupStore(), clock: new ManualClock() });
    await save.open();
    await flush();
    const serverLog = server.log.length;
    const draftBefore = JSON.stringify(store.document);
    const undoBefore = store.getState().history.size;
    const hubBefore = env.hub.invocations.length;

    // Preview with simulation of every kind.
    const base = new TestClock();
    const session = new PreviewSession({ live: provider, clock: base });
    const dom = new FakeDocument();
    const previewFrames: { speed: unknown; steer: unknown; lidar: boolean }[] = [];
    const controller = new OverlayController(dom.createElementNS("", "g"), dom, {
      config: effectiveConfig(store.document, null), source: session.source, clock: session.clock, mode: "preview", locale: "de",
      onFrame: (f) => previewFrames.push({
        speed: f.elements.e_speed.props.value, steer: f.elements.e_steer.props.rotation,
        lidar: !!f.elements.e_lidar.lidar?.fields.some((x) => x.distanceM !== undefined),
      }),
    });
    session.enterPreview();
    session.setOverride("tel", "speed", { generator: { kind: "fixed", value: 99 } });
    session.setOverride("out", "steering", { generator: { kind: "slider", value: 1, min: -1, max: 1 } });
    session.setOverride("tel", "lidarGrid", { generator: { kind: "lidar", obstacles: [{ angleDeg: 0, widthDeg: 20, distanceMm: 400 }] } });
    session.setDriverActive(true);
    base.advance(1, 0.1);
    session.setSimulateAll(true);
    base.advance(1, 0.1);
    env.clock.advance(1000);
    await flush();
    const live = liveRuntime.step(1, liveHud.source);

    // The preview shows the simulation …
    expect(previewFrames.at(-1)).toMatchObject({ speed: 99, steer: 45, lidar: true });
    // … the other consumer of the same live store does not.
    expect(live.elements.e_speed.props.value).toBe(12.5);
    expect(live.elements.e_steer.marker).toBe("invalid");
    expect(live.elements.e_lidar.lidar?.fields.some((x) => x.distanceM !== undefined) ?? false).toBe(false);
    expect(provider.driverActive()).toBe(false);

    // No hub writes or commands, no control sending, no draft change, no request to the overlay server.
    expect(env.hub.invocations.slice(hubBefore).filter((c) => !READ_ONLY.has(c.name))).toEqual([]);
    expect(controlCalls).toEqual([]);
    expect(JSON.stringify(store.document)).toBe(draftBefore);
    expect(store.getState().history.size).toBe(undoBefore);
    expect(server.log.length).toBe(serverLog);
    expect(save.getState()).toMatchObject({ status: "saved", dirty: false });

    // Leaving the preview does not reactivate sending.
    controller.dispose();
    session.leavePreview();
    session.dispose();
    expect(useControlFlowStore.getState()).toMatchObject({ editorPaused: true, updatesEnabled: false });
    expect(controlCalls).toEqual([]);
    liveHud.release();
    save.dispose();
    car.release();
  });
});
