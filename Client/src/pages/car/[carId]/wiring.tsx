import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import ConfigGuard from "@/components/config-guard";
import { parseOptionSchemas } from "@/components/config/options-language";
import WiringDiagramView from "@/components/config/pin-boards/wiring-diagram";
import { buildWiring, wireList, type WiringChannel, type WiringManager } from "@/components/config/pin-boards/wiring-model";
import { PI_BOARD_LABELS, piBoardVariant, type PiBoardVariant } from "@/components/config/pin-boards/pin-boards";
import { useLiveTelemetry } from "@/components/config/pin-boards/use-live-telemetry";

// Wiring diagram of a vehicle, generated from its channel map: every part on
// its pin or PCA9685 channel, the I²C bus, power supplies, a parts list and
// a wire list. Live telemetry of GpioPinReader/PwmOutputReader channels
// lights the LEDs and turns the servo horns.

const btn = "px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700";
const field = "bg-zinc-800 text-zinc-100 border border-zinc-700 rounded px-2 py-1 text-xs";

const KIND_LABEL: Record<string, string> = {
  servo: "Servo", esc: "ESC + motor", led: "LED", relay: "Relay / MOSFET module", buzzer: "Buzzer",
  button: "Button / switch", output: "Digital output", input: "Digital input",
};

export default function WiringPage() {
  const router = useRouter();
  const carId = router.query.carId ? parseInt(router.query.carId as string) : undefined;
  const [managers, setManagers] = useState<WiringManager[]>([]);
  const [channels, setChannels] = useState<WiringChannel[]>([]);
  const [boardModel, setBoardModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [variant, setVariant] = useState<PiBoardVariant | null>(null);
  const [hovered, setHovered] = useState<string | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const svgRef = useRef<SVGSVGElement>(null);

  const load = useCallback(async () => {
    if (!carId) return;
    setLoading(true);
    try {
      const [r, o] = await Promise.all([
        fetch(`/api/cars/${carId}/channels`),
        fetch(`/api/cars/${carId}/channels/option-schemas`).then(x => (x.ok ? x.json() : null)).catch(() => null),
      ]);
      if (!r.ok) throw new Error(await r.text());
      const map = await r.json();
      setManagers(Object.entries(map.pinManagers ?? {}).map(([name, v]: [string, any]) => ({ name, type: v.type ?? "", options: v.options })));
      setChannels([
        ...Object.entries(map.controlChannels ?? {}).filter(([, v]: [string, any]) => v.isEnabled !== false).map(([name, v]: [string, any]) => ({
          kind: "control" as const, name, type: v.controlType ?? "", pinManager: v.pinManager, address: v.address, displayName: v.displayName, options: v.options,
        })),
        ...Object.entries(map.telemetryChannels ?? {}).map(([name, v]: [string, any]) => ({
          kind: "telemetry" as const, name, type: v.telemetryType ?? "", pinManager: v.pinManager, address: v.address, options: v.options,
        })),
      ]);
      setBoardModel(parseOptionSchemas(o).boardModel);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [carId]);
  useEffect(() => { void load(); }, [load]);

  const diagram = useMemo(() => buildWiring(managers, channels, boardModel), [managers, channels, boardModel]);
  const wires = useMemo(() => wireList(diagram), [diagram]);
  const shownVariant = variant ?? piBoardVariant(boardModel);
  const readerNames = useMemo(() => [...diagram.piDevices, ...diagram.pcas.flatMap(p => p.devices)].flatMap(d => d.readers.map(r => r.name)), [diagram]);
  const live = useLiveTelemetry(carId, readerNames);

  const allDevices = useMemo(() => [...diagram.piDevices, ...diagram.pcas.flatMap(p => p.devices)], [diagram]);
  const focus = allDevices.find(d => d.id === (hovered ?? selected));

  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const text = `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
    const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `wiring-car-${carId}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!carId || loading) return <div className="p-8 text-zinc-300">Loading…</div>;

  return (
    <ConfigGuard carId={carId}>
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 print:bg-white print:text-black">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 print:hidden">
          <div className="flex items-center gap-3">
            <Link href={`/car/${carId}/channels`} className="text-blue-400 hover:underline text-sm">&larr; Channels</Link>
            <h1 className="text-lg">Wiring diagram — car {carId}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={field} value={shownVariant} onChange={e => setVariant(e.target.value as PiBoardVariant)} title={boardModel ? `Detected: ${boardModel}` : "Board model not reported"}>
              {(Object.keys(PI_BOARD_LABELS) as PiBoardVariant[]).map(v => <option key={v} value={v}>{PI_BOARD_LABELS[v]}{v === piBoardVariant(boardModel) && boardModel ? " (detected)" : ""}</option>)}
            </select>
            <button className={btn} onClick={load}>Reload</button>
            <button className={btn} onClick={downloadSvg}>Download SVG</button>
            <button className={btn} onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {error && <div className="mb-3 text-xs text-red-300 border border-red-800 rounded p-2">{error}</div>}

        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="rounded border border-zinc-800 overflow-hidden">
            <WiringDiagramView ref={svgRef} diagram={diagram} variant={shownVariant} live={live} highlighted={hovered ?? selected}
              onHover={setHovered} onSelect={id => setSelected(s => (s === id ? undefined : id))} />
          </div>

          <aside className="space-y-3 text-xs print:hidden">
            <div className="rounded border border-zinc-800 bg-zinc-900 p-2 min-h-[120px]">
              {focus ? (
                <>
                  <div className="text-sm text-zinc-100 font-semibold">{focus.title}</div>
                  <div className="text-zinc-400 mb-1">
                    {KIND_LABEL[focus.kind]} · {focus.endpoint.board === "pi" ? `Pi pin ${focus.endpoint.pin}` : `${focus.endpoint.manager} channel ${focus.endpoint.channel}`}
                    {focus.pin && focus.endpoint.board === "pi" ? ` · ${focus.pin.mode}${focus.pin.mode === "Input" ? `, pull ${focus.pin.pull}` : ""}${focus.pin.activeLow ? ", active low" : ""}` : ""}
                  </div>
                  {focus.controls.length > 0 && <div><span className="text-zinc-500">Controls:</span> <span className="font-mono">{focus.controls.join(", ")}</span></div>}
                  {focus.readers.length > 0 && (
                    <div><span className="text-zinc-500">Telemetry:</span> {focus.readers.map(r => (
                      <span key={r.name} className="font-mono mr-2">{r.name}{live[r.name] ? <span className="text-yellow-200"> = {String(live[r.name].value)}</span> : null}</span>
                    ))}</div>
                  )}
                  <ul className="mt-1 list-disc pl-4 text-zinc-300 space-y-0.5">{focus.notes.map(n => <li key={n}>{n}</li>)}</ul>
                </>
              ) : (
                <div className="text-zinc-500">Hover or click a part or wire for its details. Wires of the selected part stay highlighted.</div>
              )}
            </div>

            {diagram.warnings.length > 0 && (
              <div className="rounded border border-amber-800 bg-amber-950/40 p-2 text-amber-200">
                <div className="font-semibold mb-1">Check the wiring ({diagram.warnings.length})</div>
                <ul className="list-disc pl-4 space-y-0.5">{diagram.warnings.map(w => <li key={w}>{w}</li>)}</ul>
              </div>
            )}

            <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
              <div className="font-semibold text-zinc-200 mb-1">Parts list</div>
              <table className="w-full">
                <tbody>
                  {diagram.bom.map(b => (
                    <tr key={b.item} className="align-top">
                      <td className="pr-2 text-right font-mono text-zinc-300">{b.count}×</td>
                      <td className="text-zinc-200">{b.item}{b.note && <div className="text-[10px] text-zinc-500">{b.note}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {diagram.software.length > 0 && (
              <div className="rounded border border-zinc-800 bg-zinc-900 p-2 text-zinc-400">
                <span className="text-zinc-300">Without hardware:</span> <span className="font-mono">{diagram.software.join(", ")}</span>
              </div>
            )}
            <div className="text-[10px] text-zinc-500 leading-snug">
              Parts are derived from the control type; GpioOutput becomes a relay or buzzer when its name says so (relay, pump, horn …), otherwise an LED.
              Colours of LEDs follow their names (blinker, rear, head …).
            </div>
          </aside>
        </div>

        <div className="mt-4 rounded border border-zinc-800 bg-zinc-900 p-2 text-xs print:border-zinc-300 print:bg-white">
          <div className="font-semibold text-zinc-200 mb-1 print:text-black">Wire list ({wires.length})</div>
          <table className="w-full">
            <thead className="text-zinc-500 text-left">
              <tr><th className="pr-3 font-normal">From</th><th className="pr-3 font-normal">To</th><th className="pr-3 font-normal">Signal</th><th className="font-normal">Note</th></tr>
            </thead>
            <tbody className="font-mono">
              {wires.map((w, i) => (
                <tr key={i} className="border-t border-zinc-800 print:border-zinc-200">
                  <td className="pr-3 py-0.5">{w.from}</td><td className="pr-3">{w.to}</td><td className="pr-3">{w.signal}</td><td className="text-zinc-500">{w.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </ConfigGuard>
  );
}
