// Test helper: a SourceHub on a FakeHub with a manual clock and fixed REST answers.
import { SourceHub } from "../hub";
import { FakeHub } from "./fake-hub";
import { ManualClock } from "./manual-clock";

export const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

export interface Channel { id: number; channelName: string; dataType?: string; readIntervalTicks?: number; subscribed?: boolean; zoneLimitsMm?: number[] }

export function setupSources(channels: Channel[], functions: { id: number; channelName: string }[] = []) {
  const clock = new ManualClock();
  const hubs: FakeHub[] = [];
  const rest: Record<string, unknown> = {};
  const fetched: string[] = [];
  let carChannels = channels;
  const sources = new SourceHub({
    clock,
    createConnection: async () => {
      const h = new FakeHub();
      hubs.push(h);
      return h;
    },
    fetchJson: async (url) => {
      fetched.push(url);
      if (url.endsWith("/telemetry")) return carChannels.map((c) => ({ dataType: "number", readIntervalTicks: 1, subscribed: false, ...c }));
      if (url.endsWith("/functions")) return functions;
      return rest[url];
    },
  });
  return {
    clock,
    sources,
    fetched,
    get hub() { return hubs[hubs.length - 1]; },
    hubs,
    setChannels(c: Channel[]) { carChannels = c; },
    /** Interest calls of the current connection, as sorted id arrays. */
    interests(carId = 1) {
      return this.hub.calls("SetTelemetryInterest").filter((a) => a[0] === carId).map((a) => a[1] as number[]);
    },
  };
}
