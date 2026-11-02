// AP13 – application wiring of the driver's control display: the flow store's
// controlling connection gets a ControlDisplayPublisher (AP05) while this
// client holds control; the driver's own HUD reads the same values locally.
import { useControlFlowStore } from "../../control-flow-store";
import { ControlDisplayPublisher } from "../sources/control-display";
import { sharedSourceHub } from "../sources/hub";
import { bindControlDisplay, type FlowStoreLike } from "./control-display-binding";

/** Starts the binding for this page; returns the stop function. */
export function startDriverControlDisplay(): () => void {
  return bindControlDisplay(useControlFlowStore as unknown as FlowStoreLike, {
    createPublisher: (hub, carId) => new ControlDisplayPublisher(hub, carId),
    acquireProvider: (carId) => sharedSourceHub().acquire(carId),
  });
}
