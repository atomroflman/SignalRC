import React, { useEffect, useState } from "react";
import { BluetoothDevice, useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

// Pairs controllers with the vehicle (OnboardFlow-Arbeitspakete.md OF08, T14).
// Runs bluetoothctl on the vehicle; needs the control session.
export default function BluetoothPanel() {
  const { messages } = useI18n();
  const t = messages.onboardFlow;
  const carSession = useControlFlowStore(s => s.carSession);
  const vehicleBluetooth = useControlFlowStore(s => s.vehicleBluetooth);
  const [devices, setDevices] = useState<BluetoothDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async (action: string, address?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await vehicleBluetooth(action, address);
      setDevices(result.devices ?? []);
      if (!result.success) setMessage(result.message ?? "?");
    } catch (e: any) {
      setMessage(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // Known devices right away, so a connected controller can be disconnected without a scan.
  useEffect(() => {
    if (carSession) run("list");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carSession]);

  if (!carSession) return <div className="text-zinc-400">{t.btNeedsSession}</div>;

  const button = "px-1.5 py-0.5 rounded border text-[10px] transition-colors disabled:opacity-50";
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className={`${button} bg-blue-900 border-blue-800 hover:bg-blue-800 text-blue-100`} disabled={busy} onClick={() => run("scan")}>
          {busy ? t.btBusy : t.btScan}
        </button>
        <button className={`${button} bg-zinc-800 border-zinc-700 hover:bg-zinc-700`} disabled={busy} onClick={() => run("list")}>
          {t.btRefresh}
        </button>
      </div>
      {message && <div className="text-red-300 break-words">{message}</div>}
      {devices !== null && devices.length === 0 && <div className="text-zinc-400">{t.btNoDevices}</div>}
      <ul className="space-y-1">
        {(devices ?? []).map(d => (
          <li key={d.address} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-zinc-100">{d.name}</div>
              <div className="font-mono text-[10px] text-zinc-500">
                {d.address}{d.paired ? ` · ${t.btPaired}` : ""}{d.connected ? ` · ${t.btConnected}` : ""}
              </div>
            </div>
            {!d.paired && (
              <button className={`${button} bg-green-900 border-green-800 hover:bg-green-800 text-green-100`} disabled={busy} onClick={() => run("pair", d.address)}>{t.btPair}</button>
            )}
            {d.paired && !d.connected && (
              <button className={`${button} bg-zinc-800 border-zinc-700 hover:bg-zinc-700`} disabled={busy} onClick={() => run("connect", d.address)}>{t.btConnect}</button>
            )}
            {d.connected && (
              <button className={`${button} bg-zinc-800 border-zinc-700 hover:bg-zinc-700`} disabled={busy} onClick={() => run("disconnect", d.address)}>{t.btDisconnect}</button>
            )}
            {d.paired && (
              <button className={`${button} bg-red-950 border-red-900 hover:bg-red-900 text-red-100`} disabled={busy} onClick={() => run("remove", d.address)}>{t.btRemove}</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
