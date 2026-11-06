import React, { useEffect, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import CollapsibleSection from "./collapsible-section";
import BluetoothPanel from "./bluetooth-panel";
import { useI18n } from "@/i18n/provider";

type VehicleInputChannel = { id: number; code: number; isAxis: boolean; name: string };
type VehicleInputDevice = { id: number; key: string; name: string; lastSeenUtc: string; channels: VehicleInputChannel[] };

// Controllers paired with the vehicle (E14): their axes and buttons become nodes of
// the vehicle flow. Live values come with the onboard flow status.
export default function VehicleInputsView({ carId, hideFlowButtons }: { carId: number; hideFlowButtons?: boolean }) {
  const { messages } = useI18n();
  const t = messages.onboardFlow;
  const nodes = useControlFlowStore(s => s.nodes);
  const status = useControlFlowStore(s => s.flowStatus);
  const registerVehicleInput = useControlFlowStore(s => s.registerVehicleInput);
  const vehicleBluetooth = useControlFlowStore(s => s.vehicleBluetooth);
  const carSession = useControlFlowStore(s => s.carSession);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  /** Bluetooth address from the device key ("AA:BB:…/Name"), or null for USB controllers. */
  const bluetoothAddress = (key: string) => {
    const address = key.split("/")[0];
    return /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address) ? address : null;
  };
  const disconnect = async (key: string) => {
    const address = bluetoothAddress(key);
    if (!address) return;
    setDisconnecting(key);
    try {
      const result = await vehicleBluetooth("disconnect", address);
      if (!result.success) alert(result.message ?? "?");
    } finally {
      setDisconnecting(null);
    }
  };
  const [devices, setDevices] = useState<VehicleInputDevice[]>([]);
  // Reload when the vehicle reports other controllers.
  const deviceSignature = (status?.devices ?? []).map(d => d.key).sort().join("|");

  useEffect(() => {
    if (!carId) return;
    fetch(`/api/flow/cars/${carId}/vehicle-inputs`)
      .then(r => (r.ok ? r.json() : []))
      .then(setDevices)
      .catch(() => setDevices([]));
  }, [carId, deviceSignature]);

  const connected = new Map((status?.devices ?? []).map(d => [d.key, d.connected]));
  const used = new Set(nodes.filter(n => n.type === "vehicleInput").map(n => n.representingId));

  return (
    <CollapsibleSection title={t.controllers} label={t.controllers}>
      {devices.length === 0 && <div className="text-zinc-400">{t.noControllers}</div>}
      <div className="space-y-3">
        {devices.map(d => (
          <div key={d.id}>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${connected.get(d.key) ? "bg-emerald-400" : "bg-zinc-600"}`} />
              <span className="font-semibold text-zinc-100 truncate">{d.name}</span>
              <span className="text-zinc-500">{connected.get(d.key) ? t.controllerConnected : t.controllerDisconnected}</span>
              {connected.get(d.key) && carSession && bluetoothAddress(d.key) && (
                <button
                  className="ml-auto px-1.5 py-0.5 rounded border text-[10px] bg-zinc-800 border-zinc-600 hover:bg-zinc-700 disabled:opacity-50"
                  disabled={disconnecting === d.key}
                  onClick={() => disconnect(d.key)}
                >
                  {disconnecting === d.key ? t.btBusy : t.btDisconnect}
                </button>
              )}
            </div>
            <ul className="mt-1 space-y-0.5">
              {d.channels.map(c => (
                <li key={c.id} className="flex items-center justify-between">
                  <span className="font-mono text-zinc-300">{c.isAxis ? t.axis : t.button} {c.name}</span>
                  {!hideFlowButtons && !used.has(c.id) && (
                    <button
                      className="ml-2 px-1 py-0.5 bg-amber-900 hover:bg-amber-800 text-amber-100 rounded text-[10px] border border-amber-800"
                      onClick={() => registerVehicleInput(c.id).catch(e => alert(String(e?.message ?? e)))}
                    >
                      {t.add}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-2 border-t border-zinc-800">
        <div className="mb-1 font-semibold text-zinc-200">{t.bluetooth}</div>
        <BluetoothPanel />
      </div>
    </CollapsibleSection>
  );
}
