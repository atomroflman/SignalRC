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
  const env = { signedIn: true };
  const sources = new SourceHub({
    clock,
    createConnection: async () => {
      const h = new FakeHub();
      hubs.push(h);
      return h;
    },
    fetchJson: async (url) => {
      fetched.push(url);
      if (url.endsWith("/overlay/sources")) {
        return {
          telemetry: carChannels.map(({ subscribed: _s, ...c }) => ({ dataType: "number", readIntervalTicks: 1, ...c })),
          outputs: functions,
        };
      }
      // Personal flags exist only for signed-in users; anonymous gets 401.
      if (url.endsWith("/telemetry")) {
        if (!env.signedIn) throw new Error("401");
        return carChannels.map((c) => ({ subscribed: false, ...c }));
      }
      return rest[url];
    },
  });
  return {
    env,
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
