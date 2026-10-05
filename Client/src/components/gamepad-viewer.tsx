import React, { useEffect, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useGamepadStore } from "./controller-store";
import GamepadAxisCalibration from "./gamepad-axis-calibration";
import GamepadAxisView from "./gamepad-axis-view";
import GamepadButtonView from "./gamepad-button-view";
import { useI18n } from "@/i18n/provider";

// Unified event model for ReactFlow: { name: string, value: number, gamepadId: string }
export type GamepadUnifiedEvent = {
  name: string; // e.g., "axis-0", "button-1"
  value: number; // always -1 to 1
  gamepadId: string;
};

export default function GamepadViewer({ onUpdate, onRegisterInputChannelValue, hideFlowButtons }: { onUpdate?: (event: GamepadUnifiedEvent) => void, onRegisterInputChannelValue?: (input: { name: string, value: number, gamepadId: string }) => void, hideFlowButtons?: boolean }) {
  const { messages } = useI18n();
  const [fps, setFps] = React.useState(15);
  const [collapsed, setCollapsed] = React.useState(true);
  const [axesCollapsed, setAxesCollapsed] = useState<{ [gpId: string]: boolean }>({});
  const [buttonsCollapsed, setButtonsCollapsed] = useState<{ [gpId: string]: boolean }>({});
  const [calibCollapsed, setCalibCollapsed] = useState<{ [gpId: string]: boolean }>({});
  const controlFlow = useControlFlowStore();
  const gamepadStore = useGamepadStore();

  useEffect(() => {
    gamepadStore.loadInitialGamepads();
    gamepadStore.pollGamepads();
    gamepadStore.setPollFps(fps);
    gamepadStore.setOnChannelChange((gp, type, i, newVal, dbId) => {
      // Unsubscribe from remote updates when local controller is detected
      // We need to find the gamepad device ID from the channel
      const gamepad = Object.values(gamepadStore.knownGamepads).find(g => 
        g.axes.some(a => a.id === dbId) || g.buttons.some(b => b.id === dbId)
      );
      if (gamepad) {
        controlFlow.unsubscribeFromGamepad(gamepad.id);
      }
      controlFlow.handleInputUpdate(dbId, newVal);
    });
    return () => {
      gamepadStore.stopPolling();
    };
  }, []);

  useEffect(() => {
    gamepadStore.setPollFps(fps);
  }, [fps]);

  return (
    <div className={collapsed ? "mt-2 bg-zinc-900 text-zinc-100 rounded-lg p-0 text-xs leading-tight" : "mt-2 bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-800 text-xs leading-tight"}>
      <button
        className="mb-2 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs border border-zinc-700 transition-colors duration-150 w-full flex items-center justify-between"
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? messages.common.expandSection(messages.gamepadViewer.title) : messages.common.collapseSection(messages.gamepadViewer.title)}
        style={collapsed ? { marginBottom: 0 } : {}}
      >
        <span>{messages.gamepadViewer.title}</span>
        <span className="ml-2">{collapsed ? '▼' : '▲'}</span>
      </button>
      {!collapsed && (
        <>
          <div className="mt-2 mb-1 font-semibold text-zinc-200 text-xs">{messages.gamepadViewer.pollInterval}</div>
          <div className="flex items-center mb-1">
            <input
              type="range"
              min={10}
              max={30}
              step={1}
              value={fps}
              onChange={e => setFps(Number(e.target.value))}
              className="mx-1 accent-blue-400 bg-zinc-800 h-2"
              style={{ width: 60 }}
            />
            <span className="ml-1 text-zinc-400 text-xs">{fps} Hz</span>
          </div>
          <div className="mt-3">
            <div className="font-bold mb-1 text-zinc-200 text-xs">{messages.gamepadViewer.gamepads}</div>
            {Object.values(gamepadStore.knownGamepads).length === 0 && <div className="text-zinc-400 text-xs">{messages.gamepadViewer.noGamepad}</div>}
            {Object.values(gamepadStore.knownGamepads).map(gp => {
              // Determine gamepad status based on device ID
              const isConnected = gp.connected;
              const isRemote = controlFlow.remoteGamepads?.has(gp.id);
              
              // Status: green = local connected, yellow = remote, red = not connected
              let statusColor = "bg-red-700 border-zinc-400";
              let statusTitle = messages.gamepadViewer.notConnected;
              if (isConnected) {
                statusColor = "bg-green-700 border-zinc-400";
                statusTitle = messages.gamepadViewer.localController;
              } else if (isRemote) {
                statusColor = "bg-yellow-500 border-zinc-400";
                statusTitle = messages.gamepadViewer.remoteController;
              }
              
              return (
              <div key={gp.id} className="mb-2 border border-zinc-700 p-1 rounded bg-zinc-800 text-xs">
                <div className="font-mono text-[10px] mb-1 text-zinc-400"><div
                  className={`inline-block mx-1 w-2 h-2 rounded-full border transition-colors duration-150 ${statusColor}`}
                  title={statusTitle}
                />{gp.id}: {gp.name.length > 40 ? gp.name.slice(0, 40) + "…" : gp.name}</div>
                {/* Calibration Section */}
                <div className="mt-2 mb-1 font-semibold text-zinc-200 text-xs flex items-center justify-between cursor-pointer" onClick={() => setCalibCollapsed(c => ({ ...c, [gp.id]: !c[gp.id] }))}>
                  <span>{messages.gamepadViewer.axisAccuracyCalibration}</span>
                  <span>{calibCollapsed[gp.id] ? '▼' : '▲'}</span>
                </div>
                {!calibCollapsed[gp.id] && Array.isArray(gp.axes) && gp.axes.length > 0 && (
                  <div className="mb-2">
                    {gp.axes.map((axis, i) => (
                      <GamepadAxisCalibration
                        key={i}
                        value={axis}
                        onVauleChange={(newValue) => gamepadStore.setChannelAccuracy(gp.name, newValue.channelId, newValue.accuracy)}
                        index={i}
                      />
                    ))}
                  </div>
                )}
                {/* Axes Section */}
                <div className="mt-2 mb-1 font-semibold text-zinc-200 text-xs flex items-center justify-between cursor-pointer" onClick={() => setAxesCollapsed(c => ({ ...c, [gp.id]: !c[gp.id] }))}>
                  <span>{messages.gamepadViewer.axes}</span>
                  <span>{axesCollapsed[gp.id] ? '▼' : '▲'}</span>
                </div>
                {!axesCollapsed[gp.id] && Array.isArray(gp.axes) && (
                  <ul className="ml-2 mb-1">
                    {gp.axes.map((axis, i) => {
                      const accuracy = typeof axis.accuracy === 'number' ? axis.accuracy : 2;
                      // Use .latestValue for live axis value
                      const value = typeof axis.latestValue === 'number' ? axis.latestValue : 0;
                      const alreadyUsed = controlFlow.nodes.some(n => n.type === "input" && n.data?.gamepadId === gp.id && n.data?.name === `axis-${i}`);
                      return (
                        <GamepadAxisView
                          key={i}
                          index={i}
                          value={value}
                          accuracy={accuracy}
                          alreadyUsed={alreadyUsed}
                          hideFlowButtons={hideFlowButtons}
                          dbId={axis.id}
                        />
                      );
                    })}
                  </ul>
                )}
                {/* Buttons Section */}
                <div className="mt-2 mb-1 font-semibold text-zinc-200 text-xs flex items-center justify-between cursor-pointer" onClick={() => setButtonsCollapsed(c => ({ ...c, [gp.id]: !c[gp.id] }))}>
                  <span>{messages.gamepadViewer.buttons}</span>
                  <span>{buttonsCollapsed[gp.id] ? '▼' : '▲'}</span>
                </div>
                {!buttonsCollapsed[gp.id] && Array.isArray(gp.buttons) && (
                  <ul className="ml-2 mb-1">
                    {gp.buttons.map((btn, i) => {
                      // Use .latestValue for live button value; pressed if > 0.5
                      const isPressed = typeof btn.latestValue === 'number' ? btn.latestValue > 0.5 : false;
                      const alreadyUsed = controlFlow.nodes.some(n => n.type === "input" && n.data?.gamepadId === gp.id && n.data?.name === `button-${i}`);
                      return (
                        <GamepadButtonView
                          key={i}
                          index={i}
                          isPressed={isPressed}
                          alreadyUsed={alreadyUsed}
                          hideFlowButtons={hideFlowButtons}
                          dbId={btn.id}
                        />
                      );
                    })}
                  </ul>
                )}
              </div>
            );
            })}
          </div>
        </>
      )}
    </div>
  );
}
