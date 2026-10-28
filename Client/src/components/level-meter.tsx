'use client';

import { useEffect, useRef, useState } from 'react';

const FLOOR_DB = -60;

/** Linear peak (0..1) → bar fill in percent on a -60..0 dBFS scale. */
function levelToPercent(level: number): number {
  if (!(level > 0)) return 0;
  const db = 20 * Math.log10(Math.min(level, 1));
  return Math.max(0, Math.min(100, ((db - FLOOR_DB) / -FLOOR_DB) * 100));
}

/** dBFS (e.g. from the Onboard) → linear peak, so both sources share one meter. */
export function dbToLevel(db: number | null | undefined): number {
  return db == null || !Number.isFinite(db) ? 0 : Math.pow(10, db / 20);
}

/**
 * Horizontal peak meter. Green below -12 dBFS, amber up to -3 dBFS, red above (clipping risk).
 */
export function LevelMeter({ level, label, className }: { level: number; label?: string; className?: string }) {
  const percent = levelToPercent(level);
  const color = percent > 95 ? 'bg-red-500' : percent > 80 ? 'bg-amber-400' : 'bg-green-500';
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      {label && <span className="w-16 shrink-0 text-[10px] text-zinc-400">{label}</span>}
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-zinc-700">
        <div className={`h-full ${color} transition-[width] duration-75`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * Peak level (0..1) of an AnalyserNode, sampled every 100 ms. 0 while no analyser is given.
 */
export function useAnalyserLevel(analyser: AnalyserNode | null): number {
  const [level, setLevel] = useState(0);
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);

  useEffect(() => {
    if (!analyser) {
      setLevel(0);
      return;
    }
    const timer = window.setInterval(() => {
      if (!bufferRef.current || bufferRef.current.length !== analyser.fftSize) {
        bufferRef.current = new Float32Array(analyser.fftSize);
      }
      const buffer = bufferRef.current;
      analyser.getFloatTimeDomainData(buffer);
      let peak = 0;
      for (let i = 0; i < buffer.length; i++) {
        const v = Math.abs(buffer[i]);
        if (v > peak) peak = v;
      }
      setLevel(peak);
    }, 100);
    return () => window.clearInterval(timer);
  }, [analyser]);

  return level;
}
