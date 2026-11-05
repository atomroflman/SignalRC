import React, { useEffect, useMemo, useRef } from "react";
import type uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { formatValue, mergeTimes } from "./series";
import type { ChannelData } from "./types";

export interface ChartSeries {
  label: string;
  color: string;
  unit?: string;
  decimals?: number;
  stepped?: boolean;
  data: ChannelData;
}

/** A text state change, drawn as a vertical line through the plot. */
export interface ChartMarker {
  t: number;
  label: string;
  color: string;
}

interface Props {
  series: ChartSeries[];
  markers?: ChartMarker[];
  height: number;
  /** Shown x range in Unix ms; undefined fits the data. */
  range?: { from: number; to: number };
  syncKey: string;
  /** Legend label of the time column. */
  timeLabel: string;
  onZoom: (from: number, to: number) => void;
  onReset: () => void;
}

type Aligned = [number[], ...(number | null | undefined)[][]];

/**
 * Joins the series on one time axis. Missing points are undefined (the line is
 * drawn across them), gaps stay null (the line breaks).
 */
function align(series: ChartSeries[]): Aligned {
  const xs = mergeTimes(series.map(s => s.data.t));
  const index = new Map<number, number>();
  xs.forEach((x, i) => index.set(x, i));
  const ys = series.map(s => {
    const y: (number | null | undefined)[] = new Array(xs.length).fill(undefined);
    s.data.t.forEach((t, i) => { y[index.get(t)!] = s.data.v[i]; });
    return y;
  });
  return [xs, ...ys];
}

/** 24 h clock; seconds when the shown span is short, the date when it spans days. */
function timeTicks(splits: number[], span: number): string[] {
  return splits.map(ms => {
    const d = new Date(ms);
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: span < 10 * 60_000 ? "2-digit" : undefined, hour12: false });
    return span > 86_400_000 ? `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${time}` : time;
  });
}

function cursorTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "–";
  const d = new Date(ms);
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

/** Dashed lines at state changes; a label where there is room for it. */
export function drawMarkers(u: uPlot, markers: ChartMarker[]) {
  if (markers.length === 0) return;
  const { ctx, bbox } = u;
  const min = u.scales.x.min ?? -Infinity;
  const max = u.scales.x.max ?? Infinity;
  const dpr = devicePixelRatio || 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.font = `${10 * dpr}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left"; // uPlot leaves "center" from its axis labels
  let lastLabelEnd = -Infinity;
  for (const m of markers) {
    if (m.t < min || m.t > max) continue;
    const x = Math.round(u.valToPos(m.t, "x", true)) + 0.5;
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = dpr;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(x, bbox.top);
    ctx.lineTo(x, bbox.top + bbox.height);
    ctx.stroke();
    const width = ctx.measureText(m.label).width + 6 * dpr;
    if (x + 2 * dpr > lastLabelEnd) {
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#18181b";
      ctx.fillRect(x + 2 * dpr, bbox.top + 2 * dpr, width, 13 * dpr);
      ctx.globalAlpha = 1;
      ctx.fillStyle = m.color;
      ctx.fillText(m.label, x + 5 * dpr, bbox.top + 3.5 * dpr);
      lastLabelEnd = x + 2 * dpr + width + 4 * dpr;
    }
  }
  ctx.restore();
}

const AXIS = { stroke: "#a1a1aa", grid: { stroke: "#27272a", width: 1 }, ticks: { stroke: "#3f3f46", width: 1 } };

/** One uPlot time chart. Charts with the same syncKey share the cursor. */
export default function HistoryChart({ series, markers = [], height, range, syncKey, timeLabel, onZoom, onReset }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const callbacks = useRef({ onZoom, onReset });
  callbacks.current = { onZoom, onReset };

  const data = useMemo(() => align(series), [series]);
  const latest = useRef({ data, range, markers });
  latest.current = { data, range, markers };
  // The chart is rebuilt only when its lines change, not for new data.
  const shape = JSON.stringify([timeLabel, series.map(s => [s.label, s.color, s.unit, s.decimals, s.stepped])]);
  // Only on/off lines: a fixed 0..1 axis instead of an auto range around a constant.
  const boolOnly = series.every(s => s.stepped);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import("uplot").then(({ default: UPlot }) => {
      if (disposed) return;
      const opts: uPlot.Options = {
        width: el.clientWidth || 600,
        height,
        ms: 1, // timestamps are Unix milliseconds
        cursor: {
          sync: { key: syncKey },
          drag: { x: true, y: false, setScale: false },
        },
        scales: { x: { time: true }, ...(boolOnly ? { y: { range: [-0.05, 1.05] as uPlot.Range.MinMax } } : {}) },
        legend: { live: true },
        axes: [
          { ...AXIS, values: (u, splits) => timeTicks(splits, (u.scales.x.max ?? 0) - (u.scales.x.min ?? 0)) },
          { ...AXIS, size: 60, ...(boolOnly ? { splits: () => [0, 1] } : {}) },
        ],
        series: [
          { label: timeLabel, value: (_u: uPlot, v: number | null) => cursorTime(v) },
          ...series.map(s => ({
            label: s.unit ? `${s.label} [${s.unit}]` : s.label,
            stroke: s.color,
            width: 1.5,
            spanGaps: false,
            paths: s.stepped ? UPlot.paths.stepped!({ align: 1 }) : undefined,
            value: (_u: uPlot, v: number | null) => formatValue(v, s.decimals),
          })),
        ],
        hooks: {
          draw: [u => drawMarkers(u, latest.current.markers)],
          setSelect: [
            u => {
              if (u.select.width < 5) return;
              const from = u.posToVal(u.select.left, "x");
              const to = u.posToVal(u.select.left + u.select.width, "x");
              u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
              callbacks.current.onZoom(from, to);
            },
          ],
        },
      };
      const u = new UPlot(opts, latest.current.data as uPlot.AlignedData, el);
      plot.current = u;
      const r = latest.current.range;
      if (r) u.setScale("x", { min: r.from, max: r.to });
      u.over.addEventListener("dblclick", () => callbacks.current.onReset());
      observer = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
      observer.observe(el);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      plot.current?.destroy();
      plot.current = null;
    };
    // data and range are applied by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, height, syncKey, boolOnly]);

  useEffect(() => {
    const u = plot.current;
    if (!u) return;
    u.setData(data as uPlot.AlignedData, !range);
    if (range) u.setScale("x", { min: range.from, max: range.to });
  }, [data, range]);

  useEffect(() => {
    plot.current?.redraw(false);
  }, [markers]);

  return <div ref={host} className="w-full history-chart" />;
}
