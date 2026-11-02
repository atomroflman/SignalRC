import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useControlFlowStore } from "../../control-flow-store";
import { isPaused } from "./control-display-binding";
import {
  controlReason, deriveHasControl, endLiveTest, GUARDED_KEY_EVENTS, installEditorKeyboardGuard, isEditorKeyboardGuarded, pauseOnEditorOpen,
  releaseForLiveTest, sendState, type KeyTargetLike, type PauseStoreLike,
} from "./editor-control";

const store = useControlFlowStore as unknown as PauseStoreLike;
const initial = useControlFlowStore.getState();

function fakeConnection() {
  const calls: unknown[][] = [];
  return { calls, state: "Connected", invoke: vi.fn(async (...args: unknown[]) => { calls.push(args); }) };
}

describe("sending pause of the overlay editor (api/README.md §6)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    useControlFlowStore.setState({ ...initial, updatesEnabled: true, isInConfigMode: false, editorPaused: false, carId: 7, carSession: "sess", connection: undefined }, true);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opening pauses sending and repeats; the control display shows the pause", async () => {
    const conn = fakeConnection();
    useControlFlowStore.setState({ connection: conn });
    // A channel with resend interval: the first send starts a repeat timer.
    useControlFlowStore.setState({ nodes: [] });
    await useControlFlowStore.getState().sendOutput(3, 0.5);
    expect(conn.calls).toHaveLength(1);

    pauseOnEditorOpen(store);
    const s = useControlFlowStore.getState();
    expect(s.updatesEnabled).toBe(false);
    expect(s.editorPaused).toBe(true);
    expect(isPaused(s)).toBe(true);
    expect(sendState(s, 7)).toBe("paused");

    await useControlFlowStore.getState().sendOutput(3, 0.9);
    vi.advanceTimersByTime(10_000);
    expect(conn.calls).toHaveLength(1);
  });

  it("clears running resend timers when pausing", async () => {
    const conn = fakeConnection();
    useControlFlowStore.setState({ connection: conn });
    // Register a resend interval the way load() does for vehicle channel nodes.
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.includes("userconfig") ? { carId: 7, id: 1, userId: 1 } : { nodes: [{ nodeId: 1, nodeTypeName: "UserSetupCarChannelNode", representingId: 3, maxResendInterval: 200, position: { x: 0, y: 0 }, params: {} }], edges: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await useControlFlowStore.getState().load(7).catch(() => {});
    vi.unstubAllGlobals();
    useControlFlowStore.setState({ carId: 7, carSession: "sess", connection: conn, updatesEnabled: true });
    await useControlFlowStore.getState().sendOutput(3, 0.5);
    vi.advanceTimersByTime(250);
    const before = conn.calls.length;
    expect(before).toBeGreaterThan(1); // the repeat timer was running
    pauseOnEditorOpen(store);
    vi.advanceTimersByTime(2000);
    expect(conn.calls.length).toBe(before);
  });

  it("leaving the configuration page does not reactivate an editor pause", () => {
    pauseOnEditorOpen(store);
    const s = useControlFlowStore.getState();
    s.setConfigMode(true);
    s.setConfigMode(false);
    expect(useControlFlowStore.getState().updatesEnabled).toBe(false);
    expect(useControlFlowStore.getState().editorPaused).toBe(true);
  });

  it("without an editor pause the configuration page keeps its behavior", () => {
    const s = useControlFlowStore.getState();
    s.setConfigMode(true);
    expect(useControlFlowStore.getState().updatesEnabled).toBe(false);
    s.setConfigMode(false);
    expect(useControlFlowStore.getState().updatesEnabled).toBe(true);
  });

  it("only the explicit release sends again; pausing again is possible", async () => {
    const conn = fakeConnection();
    useControlFlowStore.setState({ connection: conn });
    pauseOnEditorOpen(store);
    releaseForLiveTest(store);
    let s = useControlFlowStore.getState();
    expect(s.updatesEnabled).toBe(true);
    expect(s.editorPaused).toBe(false);
    expect(sendState(s, 7)).toBe("live");
    await s.sendOutput(3, 0.2);
    expect(conn.calls).toHaveLength(1);
    endLiveTest(store);
    s = useControlFlowStore.getState();
    expect(sendState(s, 7)).toBe("paused");
    expect(s.editorPaused).toBe(true);
  });

  it("reports no session for another vehicle or without control session", () => {
    expect(sendState({ updatesEnabled: true, isInConfigMode: false, carSession: "x", carId: 7 }, 8)).toBe("noSession");
    expect(sendState({ updatesEnabled: true, isInConfigMode: false, carId: 7 }, 7)).toBe("noSession");
    expect(sendState({ updatesEnabled: true, isInConfigMode: true, carSession: "x", carId: 7 }, 7)).toBe("paused");
  });
});

describe("management permission on the client (OverlayAccess mirror, D73)", () => {
  // Anonymous session user: no loginName is needed.
  const me = { userId: 5 };

  it("requires a session user", () => {
    expect(deriveHasControl(null, { isConnected: true, driverId: "5" })).toBe(false);
    expect(deriveHasControl({ userId: null }, { isConnected: true, driverId: "5" })).toBe(false);
    expect(controlReason(undefined, { isConnected: true, driverId: "5" })).toBe("noSession");
  });

  it("follows the announced driver of a connected vehicle (CarStateUpdated)", () => {
    expect(deriveHasControl(me, { isConnected: true, driverId: "5" })).toBe(true);
    expect(controlReason(me, { isConnected: true, driverId: "6" })).toBe("notDriver");
    expect(controlReason(me, { isConnected: true, driverId: null })).toBe("notDriver");
  });

  it("is local-only while the vehicle is offline or its state unknown", () => {
    expect(controlReason(me, undefined)).toBe("unknown");
    expect(controlReason(me, { isConnected: false, driverId: "5" })).toBe("offline");
    expect(deriveHasControl(me, undefined)).toBe(false);
    expect(deriveHasControl(me, { isConnected: false, driverId: "5" })).toBe(false);
  });
});

describe("keyboard separation", () => {
  /** document → window bubbling of one key event, enough to model the guard. */
  function page() {
    const docListeners = new Map<string, ((e: { stopPropagation(): void }) => void)[]>();
    const doc: KeyTargetLike = {
      addEventListener: (t, l) => docListeners.set(t, [...(docListeners.get(t) ?? []), l]),
      removeEventListener: (t, l) => docListeners.set(t, (docListeners.get(t) ?? []).filter((x) => x !== l)),
    };
    const windowHandler = vi.fn();
    const reactHandler = vi.fn();
    const press = (type: string) => {
      let stopped = false;
      const e = { stopPropagation: () => { stopped = true; } };
      reactHandler(type); // the React root sits below the document
      for (const l of docListeners.get(type) ?? []) l(e);
      if (!stopped) windowHandler(type);
    };
    return { doc, press, windowHandler, reactHandler, docListeners };
  }

  it("editor keys run the editor's handlers but never reach window-level vehicle input", () => {
    const p = page();
    const uninstall = installEditorKeyboardGuard(p.doc);
    expect(isEditorKeyboardGuarded()).toBe(true);
    for (const t of GUARDED_KEY_EVENTS) p.press(t);
    expect(p.reactHandler).toHaveBeenCalledTimes(3);
    expect(p.windowHandler).not.toHaveBeenCalled();
    uninstall();
    uninstall();
    expect(isEditorKeyboardGuarded()).toBe(false);
    p.press("keydown");
    expect(p.windowHandler).toHaveBeenCalledTimes(1);
  });
});
