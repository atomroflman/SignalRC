// D75 – pointer handling of clickable HUD elements in the live HUD over the
// video (video-hud.tsx). The scene puts each interaction on its element or
// part as data-ovl-interaction; globals.css turns pointer events on for them
// only when the container allows it (data-ovl-hud-interact), so everything
// else stays click-through.
//
// The driver applies a click to the own flow directly. A viewer may only use
// public interactions and sends element, part and action to the server, which
// takes input and value from the published document and forwards them to the
// driver (CarConnectionHub.HudInput).
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useControlFlowStore } from "../../control-flow-store";
import type { Interaction } from "../document/types";
import { interactionValue, sliderValue, type HudInputAction } from "./hud-input";

export type HudInteractMode = "all" | "public";

/** Pointer position along an element as 0 … 1: left to right, or bottom to top when it is taller than wide. */
export function sliderFraction(rect: { left: number; top: number; width: number; height: number }, x: number, y: number): number {
  if (rect.width >= rect.height) return rect.width > 0 ? (x - rect.left) / rect.width : 0;
  return rect.height > 0 ? (rect.top + rect.height - y) / rect.height : 0;
}

/** The interaction under a pointer target, with the element and SVG part it belongs to. */
export function interactionAt(target: Element, mode: HudInteractMode): { node: Element; interaction: Interaction; element: string; part?: string } | undefined {
  const node = target.closest("[data-ovl-interaction]");
  if (!node || (mode === "public" && !node.hasAttribute("data-ovl-public"))) return undefined;
  const element = node.closest("[data-ovl-id]")?.getAttribute("data-ovl-id");
  if (!element) return undefined;
  try {
    const interaction = JSON.parse(node.getAttribute("data-ovl-interaction")!) as Interaction;
    return { node, interaction, element, part: node.getAttribute("data-ovl-part") ?? undefined };
  } catch {
    return undefined;
  }
}

/** Whether this browser may click HUD elements of the car, and the pointer handler for the HUD container. */
export function useHudInteraction(carId: number): { mode: HudInteractMode | undefined; onPointerDown: (e: ReactPointerEvent) => void } {
  const isDriver = useControlFlowStore((s) => !!s.carSession && s.carId === carId);
  const connected = useControlFlowStore((s) => !!s.connection);
  const mode: HudInteractMode | undefined = isDriver ? "all" : connected ? "public" : undefined;
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const send = useCallback((interaction: Interaction, element: string, part: string | undefined, action: HudInputAction, value: number) => {
    const store = useControlFlowStore.getState();
    if (modeRef.current === "all") {
      store.applyHudInput(interaction.input, action, value);
    } else if (store.connection) {
      store.connection.invoke("HudInput", carId, element, part ?? null, action, value)
        .catch((err: unknown) => console.warn("HUD input was not accepted", err));
    }
  }, [carId]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const mode = modeRef.current;
    if (!mode || e.button !== 0) return;
    const hit = interactionAt(e.target as Element, mode);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    const { node, interaction, element, part } = hit;
    const value = interactionValue(interaction);
    const pointerId = e.pointerId;
    const until = (onMove: ((ev: PointerEvent) => void) | undefined, onEnd: () => void) => {
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (onMove) window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        onEnd();
      };
      if (onMove) window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    switch (interaction.kind) {
      case "button":
        send(interaction, element, part, "press", value);
        until(undefined, () => send(interaction, element, part, "release", 0));
        break;
      case "toggle":
        send(interaction, element, part, "toggle", value);
        break;
      case "value":
        send(interaction, element, part, "set", value);
        break;
      case "slider": {
        // The element's box at the start of the drag; at most one message per 50 ms.
        const rect = node.getBoundingClientRect();
        let last: number | undefined;
        let lastSentAt = 0;
        let pending: number | undefined;
        const emit = (x: number, y: number, force: boolean) => {
          const v = sliderValue(interaction, sliderFraction(rect, x, y));
          if (v === undefined || v === last) return;
          const now = performance.now();
          if (!force && now - lastSentAt < 50) { pending = v; return; }
          last = v;
          pending = undefined;
          lastSentAt = now;
          send(interaction, element, part, "set", v);
        };
        emit(e.clientX, e.clientY, true);
        let lastX = e.clientX, lastY = e.clientY;
        until((ev) => {
          if (ev.pointerId !== pointerId) return;
          lastX = ev.clientX;
          lastY = ev.clientY;
          emit(lastX, lastY, false);
        }, () => {
          if (pending !== undefined) emit(lastX, lastY, true);
        });
        break;
      }
    }
  }, [send]);

  return { mode, onPointerDown };
}
