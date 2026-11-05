import React, { useEffect, useRef } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { stateColor, textAt } from "./series";
import type { TextData } from "./types";

interface Props {
  /** Text channels by name, in display order. */
  channels: { name: string; data: TextData }[];
  extent: { from: number; to: number };
  range?: { from: number; to: number };
  syncKey: string;
  timeLabel: string;
  onZoom: (from: number, to: number) => void;
  onReset: () => void;
}

const ROW = 26;
/** Same as the y axis of the charts, so the time axes line up. */
const AXIS_SIZE = 60;

/**
 * One row per text channel with a colored band per state, on the same time
 * axis as the charts (shared cursor, drag to zoom). The states under the
 * cursor are shown below.
 */
export default function EventLane({ channels, extent, range, syncKey, timeLabel, onZoom, onReset }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const latest = useRef({ channels, extent, range, onZoom, onReset, timeLabel });
  latest.current = { channels, extent, range, onZoom, onReset, timeLabel };
  const rows = channels.length;
  const names = channels.map(c => c.name).join("|");

  useEffect(() => {
    const el = host.current;
    if (!el || rows === 0) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    // uPlot keeps some padding above and below the plot area
    const height = rows * ROW + 24;
    void import("uplot").then(({ default: UPlot }) => {
      if (disposed) return;
      const u = new UPlot({
        width: el.clientWidth || 600,
        height,
        ms: 1,
        legend: { show: false },
        cursor: { sync: { key: syncKey }, drag: { x: true, y: false, setScale: false }, points: { show: false } },
        scales: { x: { time: true }, y: { range: [0, rows] } },
        axes: [
          { show: false },
          { size: AXIS_SIZE, grid: { show: false }, ticks: { show: false }, values: () => [] },
        ],
        series: [{}, { scale: "y", stroke: "transparent", points: { show: false } }],
        hooks: {
          draw: [p => drawLanes(p)],
          setCursor: [p => showReadout(p)],
          setSelect: [
            p => {
              if (p.select.width < 5) return;
              const from = p.posToVal(p.select.left, "x");
              const to = p.posToVal(p.select.left + p.select.width, "x");
              p.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              latest.current.onZoom(from, to);
            },
          ],
        },
      }, data(), el);
      plot.current = u;
      apply(u);
      u.over.addEventListener("dblclick", () => latest.current.onReset());
      observer = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
      observer.observe(el);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, rows, syncKey]);

  useEffect(() => {
    if (plot.current) apply(plot.current);
  }, [channels, extent.from, extent.to, range]);

  function data(): uPlot.AlignedData {
    const { from, to } = latest.current.extent;
    return [[from, to], [null, null]];
  }

  function apply(u: uPlot) {
    u.setData(data(), false);
    const r = latest.current.range ?? latest.current.extent;
    u.setScale("x", { min: r.from, max: r.to });
  }

  function drawLanes(u: uPlot) {
    const { channels: list, extent: ext } = latest.current;
    const { ctx, bbox } = u;
    const dpr = devicePixelRatio || 1;
    const rowH = bbox.height / Math.max(1, list.length);
    ctx.save();
    ctx.font = `${10 * dpr}px sans-serif`;
    ctx.textBaseline = "middle";
    list.forEach((c, r) => {
      const y = bbox.top + r * rowH;
      // channel name in the axis gutter
      ctx.fillStyle = "#a1a1aa";
      ctx.textAlign = "right";
      let name = c.name;
      while (name.length > 3 && ctx.measureText(name).width > bbox.left - 6 * dpr) name = name.slice(0, -2) + "…";
      ctx.fillText(name, bbox.left - 4 * dpr, y + rowH / 2);

      ctx.save();
      ctx.beginPath();
      ctx.rect(bbox.left, y, bbox.width, rowH);
      ctx.clip();
      ctx.textAlign = "left";
      for (let i = 0; i < c.data.t.length; i++) {
        const v = c.data.v[i];
        if (v === null) continue;
        const end = i + 1 < c.data.t.length ? c.data.t[i + 1] : ext.to;
        const x0 = u.valToPos(c.data.t[i], "x", true);
        const x1 = u.valToPos(end, "x", true);
        if (x1 < bbox.left || x0 > bbox.left + bbox.width) continue;
        const color = stateColor(v);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = color;
        ctx.fillRect(x0, y + 2 * dpr, Math.max(1, x1 - x0), rowH - 4 * dpr);
        ctx.globalAlpha = 1;
        ctx.fillRect(x0, y + 2 * dpr, Math.max(1, dpr), rowH - 4 * dpr);
        const left = Math.max(x0, bbox.left) + 4 * dpr;
        if (x1 - left > 24 * dpr) {
          ctx.fillStyle = "#f4f4f5";
          ctx.fillText(v, left, y + rowH / 2, x1 - left - 4 * dpr);
        }
      }
      ctx.restore();
    });
    ctx.restore();
  }

  function showReadout(u: uPlot) {
    const el = readout.current;
    if (!el) return;
    const left = u.cursor.left ?? -1;
    if (left < 0) { el.textContent = " "; return; }
    const time = u.posToVal(left, "x");
    const d = new Date(time);
    const parts = latest.current.channels.map(c => `${c.name}: ${textAt(c.data, time) ?? "–"}`);
    el.textContent = `${latest.current.timeLabel} ${d.toLocaleTimeString([], { hour12: false })} · ${parts.join(" · ")}`;
  }

  if (rows === 0) return null;
  return (
    <div>
      <div ref={host} className="w-full" />
      <div ref={readout} className="text-[11px] text-zinc-400 font-mono truncate pl-[60px]">&nbsp;</div>
    </div>
  );
}
