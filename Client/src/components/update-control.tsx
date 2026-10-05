"use client";

import React from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

export default function UpdateControl() {
  const { messages } = useI18n();
  const { updatesEnabled, isInConfigMode, setUpdatesEnabled, setConfigMode, carSession, stopConnection, setCarId, carId } = useControlFlowStore();

  const isConnected = !!carSession;
  const status = !isConnected
    ? { color: 'bg-red-500', bg: 'bg-red-900/30', border: 'border-red-700', text: messages.updateControl.disconnected }
    : updatesEnabled
      ? { color: 'bg-green-500', bg: 'bg-green-900/30', border: 'border-green-700', text: messages.updateControl.updatesActive }
      : { color: 'bg-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', text: messages.updateControl.pausedIgnitionOff };

  return (
    <div className="p-2 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className={`w-1.5 h-1.5 rounded-full ${status.color}`} />
          <h3 className="text-sm font-medium">{messages.updateControl.title}</h3>
        </div>
        <div className="flex items-center space-x-1">
          <button
            className="px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white"
            title={updatesEnabled ? messages.carControl.pauseUpdates : messages.carControl.resumeUpdates}
            onClick={() => setUpdatesEnabled(!updatesEnabled)}
          >
            ⏸
          </button>
          <button
            className="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
            title={messages.carControl.stopControlSession}
            onClick={() => { stopConnection(); setCarId(undefined); }}
          >
            ■
          </button>
        </div>
      </div>
      
      <div className="space-y-2 mt-2">
        {/* Status chip mirroring top banner */}
        <div className={`px-2 py-1 rounded ${status.bg} ${status.border} border text-[11px]`}>{status.text}{isConnected ? messages.updateControl.carStatus(carId) : ''}</div>
        {/* Updates Toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs">{messages.updateControl.updatesToVehicle}</label>
          <button
            onClick={() => setUpdatesEnabled(!updatesEnabled)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              updatesEnabled
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-red-600 text-white hover:bg-red-700"
            }`}
          >
            {updatesEnabled ? messages.common.enabled : messages.common.disabled}
          </button>
        </div>

        {/* Config Mode Toggle */}
        <div className="flex items-center justify-between">
          <label className="text-xs">{messages.updateControl.configurationMode}</label>
          <button
            onClick={() => setConfigMode(!isInConfigMode)}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              isInConfigMode
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-zinc-600 text-white hover:bg-zinc-700"
            }`}
          >
            {isInConfigMode ? messages.updateControl.configMode : messages.updateControl.normalMode}
          </button>
        </div>

        {/* Status Info */}
        <div className="text-[11px] text-zinc-400 mt-1">
          <p>
            <strong>{messages.common.status}:</strong> {
              !updatesEnabled && isInConfigMode ? messages.updateControl.updatesDisabledConfigDefault :
              !updatesEnabled ? messages.updateControl.updatesDisabledManual :
              isInConfigMode ? messages.updateControl.updatesEnabledManualOverride :
              messages.updateControl.updatesActivePlain
            }
          </p>
          <p className="mt-1">
            <strong>{messages.common.note}:</strong> {messages.updateControl.configNote}
          </p>
        </div>
      </div>
    </div>
  );
}
