// Received telemetry traffic of this browser (diagnostics panel). Measured in
// the hub protocol, i.e. on the raw text of each frame, and only while a
// diagnostics panel holds the meter; otherwise the protocol only delegates.
import type { HubMessage, IHubProtocol, ILogger, TransferFormat } from "@microsoft/signalr";
import type { TimerClock } from "./types";
import { systemClock } from "./types";

export const TRAFFIC_WINDOW_MS = 5000;
const BUCKET_MS = 250;
const BUCKETS = TRAFFIC_WINDOW_MS / BUCKET_MS;

export interface TrafficTotal {
  messages: number;
  bytes: number;
  realBytes: number;
}

export interface TrafficRate {
  perSecond: number;
  bytesPerSecond: number;
  realBytesPerSecond: number;
  total: TrafficTotal;
}

/** Messages and bytes over a sliding window of 250 ms buckets (same rules as the server's RateWindow). */
export class RateWindow {
  private readonly start = new Array<number>(BUCKETS).fill(-Infinity);
  private readonly count = new Array<number>(BUCKETS).fill(0);
  private readonly bytes = new Array<number>(BUCKETS).fill(0);
  private readonly real = new Array<number>(BUCKETS).fill(0);
  readonly total: TrafficTotal = { messages: 0, bytes: 0, realBytes: 0 };

  constructor(private readonly since: number) {}

  add(now: number, bytes: number, realBytes: number) {
    const start = Math.floor(now / BUCKET_MS) * BUCKET_MS;
    const i = ((start / BUCKET_MS) % BUCKETS + BUCKETS) % BUCKETS;
    if (this.start[i] !== start) {
      this.start[i] = start;
      this.count[i] = this.bytes[i] = this.real[i] = 0;
    }
    this.count[i]++;
    this.bytes[i] += bytes;
    this.real[i] += realBytes;
    this.total.messages++;
    this.total.bytes += bytes;
    this.total.realBytes += realBytes;
  }

  rate(now: number): TrafficRate {
    let count = 0, bytes = 0, real = 0;
    for (let i = 0; i < BUCKETS; i++) {
      if (this.start[i] <= now - TRAFFIC_WINDOW_MS || this.start[i] > now) continue;
      count += this.count[i];
      bytes += this.bytes[i];
      real += this.real[i];
    }
    const lower = (Math.floor((now - TRAFFIC_WINDOW_MS) / BUCKET_MS) + 1) * BUCKET_MS;
    const span = Math.min(Math.max(Math.min(now - lower, now - this.since), 1000), TRAFFIC_WINDOW_MS) / 1000;
    return { perSecond: count / span, bytesPerSecond: bytes / span, realBytesPerSecond: real / span, total: { ...this.total } };
  }
}

export type TrafficKind = "tlm" | "ctl";

/** permessage-deflate as negotiated by the browser's WebSocket; unknown without an open WebSocket. */
export type WsCompression = "none" | "deflate" | "unknown";

/** UTF-8 length of a string without encoding it. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

export class TrafficMeter {
  private users = 0;
  private readonly windows = new Map<string, RateWindow>();
  private extensions: string | undefined;

  constructor(private readonly clock: TimerClock = systemClock) {}

  get active() {
    return this.users > 0;
  }

  /** Measures while at least one holder exists; returns the release. */
  activate(): () => void {
    this.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users--;
    };
  }

  record(kind: TrafficKind, carId: number, bytes: number, realBytes: number) {
    const key = `${carId}:${kind}`;
    let w = this.windows.get(key);
    const now = this.clock.now();
    if (!w) this.windows.set(key, (w = new RateWindow(now)));
    w.add(now, bytes, realBytes);
  }

  rate(kind: TrafficKind, carId: number): TrafficRate {
    return this.windows.get(`${carId}:${kind}`)?.rate(this.clock.now())
      ?? { perSecond: 0, bytesPerSecond: 0, realBytesPerSecond: 0, total: { messages: 0, bytes: 0, realBytes: 0 } };
  }

  /** Called when a WebSocket of the hub opened, with its negotiated extensions. */
  webSocketOpened(extensions: string) {
    this.extensions = extensions;
  }

  webSocketClosed() {
    this.extensions = undefined;
  }

  get compression(): WsCompression {
    if (this.extensions === undefined) return "unknown";
    return /permessage-deflate/i.test(this.extensions) ? "deflate" : "none";
  }
}

/** "Real" size of a message's content, every value in full; undefined = unknown vehicle. */
export type RealSize = (target: string, args: unknown[]) => number | undefined;

const MEASURED: Record<string, TrafficKind> = { Tlm: "tlm", Ctl: "ctl" };
const RECORD_SEPARATOR = "\u001e";

/**
 * Wraps the JSON hub protocol: while the meter is active, every received Tlm
 * and Ctl is recorded with the UTF-8 length of its frame (text plus record
 * separator) and its real size.
 */
export class MeteredProtocol implements IHubProtocol {
  readonly name: string;
  readonly version: number;
  readonly transferFormat: TransferFormat;

  constructor(private readonly inner: IHubProtocol, private readonly meter: TrafficMeter, private readonly realSize: RealSize) {
    this.name = inner.name;
    this.version = inner.version;
    this.transferFormat = inner.transferFormat;
  }

  parseMessages(input: string | ArrayBuffer, logger: ILogger): HubMessage[] {
    const messages = this.inner.parseMessages(input, logger);
    if (!this.meter.active || typeof input !== "string") return messages;
    const records = input.split(RECORD_SEPARATOR);
    const aligned = records.length - 1 === messages.length;
    messages.forEach((m, i) => {
      if (m.type !== 1) return;
      const kind = MEASURED[m.target];
      if (!kind) return;
      const args = m.arguments as unknown[];
      // One record per message; otherwise re-serialised (not expected with the JSON protocol).
      const bytes = aligned ? utf8Length(records[i]) + 1 : utf8Length(JSON.stringify(m)) + 1;
      this.meter.record(kind, Number(args[0]), bytes, this.realSize(m.target, args) ?? bytes);
    });
    return messages;
  }

  writeMessage(message: HubMessage): string | ArrayBuffer {
    return this.inner.writeMessage(message);
  }
}

/** A WebSocket constructor that reports the negotiated extensions (browser only). */
export function meteredWebSocket(meter: TrafficMeter): typeof WebSocket | undefined {
  if (typeof WebSocket === "undefined") return undefined;
  const Base = WebSocket;
  return class MeteredWebSocket extends Base {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      this.addEventListener("open", () => meter.webSocketOpened(this.extensions));
      this.addEventListener("close", () => meter.webSocketClosed());
    }
  };
}
