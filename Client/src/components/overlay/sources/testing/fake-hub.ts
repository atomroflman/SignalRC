// Test double: an in-memory HubLike that records invocations and lets tests push server messages.
import type { HubLike } from "../hub";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

export class FakeHub implements HubLike {
  readonly invocations: { name: string; args: unknown[] }[] = [];
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly lifecycle = { reconnecting: [] as Handler[], reconnected: [] as Handler[], close: [] as Handler[] };
  /** Return values of invoke by method name. */
  readonly results: Record<string, unknown> = {};
  failStart = false;
  started = false;
  stopped = false;

  on(name: string, handler: Handler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name)!.add(handler);
  }

  off(name: string, handler: Handler) {
    this.handlers.get(name)?.delete(handler);
  }

  async invoke(name: string, ...args: unknown[]) {
    this.invocations.push({ name, args });
    return this.results[name];
  }

  onreconnecting(cb: Handler) { this.lifecycle.reconnecting.push(cb); }
  onreconnected(cb: Handler) { this.lifecycle.reconnected.push(cb); }
  onclose(cb: Handler) { this.lifecycle.close.push(cb); }

  async start() {
    if (this.failStart) throw new Error("start failed");
    this.started = true;
  }

  async stop() {
    this.stopped = true;
  }

  /** Simulates a server push. */
  push(name: string, ...args: unknown[]) {
    for (const h of [...(this.handlers.get(name) ?? [])]) h(...args);
  }

  reconnecting() { for (const cb of this.lifecycle.reconnecting) cb(); }
  reconnected() { for (const cb of this.lifecycle.reconnected) cb("new-id"); }
  close() { for (const cb of this.lifecycle.close) cb(); }

  calls(name: string) {
    return this.invocations.filter((i) => i.name === name).map((i) => i.args);
  }
}
