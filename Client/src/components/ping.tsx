import React, { useEffect, useState, useRef, useCallback } from "react";
import { useControlFlowStore } from "./control-flow-store";
import { useI18n } from "@/i18n/provider";

interface PingResult {
    rttMs: number;
    srtMs: number;
    catMs: number;
    timestamp: Date;
}

const PING_HISTORY_SIZE = 20;
const PING_INTERVALS = [500, 1000, 2000, 5000] as const;

const Ping: React.FC = () => {
    const { messages } = useI18n();
    const [currentRtt, setCurrentRtt] = useState<number | null>(null);
    const [currentSrt, setCurrentSrt] = useState<number | null>(null);
    const [currentCat, setCurrentCat] = useState<number | null>(null);
    const [pingHistory, setPingHistory] = useState<PingResult[]>([]);
    const [pingIntervalMs, setPingIntervalMs] = useState(2000);
    const [carConnected, setCarConnected] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const carId = useControlFlowStore((state) => state.carId);
    const controlConnection = useControlFlowStore((state) => state.connection);

    const sendPing = useCallback(async () => {
        if (!carId || !controlConnection || controlConnection.state !== "Connected") {
            setCarConnected(false);
            return;
        }

        const jsSendTimestamp = Date.now();
        const perfStart = performance.now();
        try {
            const result = await controlConnection.invoke("PingCar", carId);
            const rttMs = Math.round((performance.now() - perfStart) * 100) / 100;

            if (!result) {
                setCarConnected(false);
                return;
            }

            const srtMs = Math.round(result.serverRequestMs * 100) / 100;
            const catMs = result.carTimestamp - jsSendTimestamp;

            setCarConnected(true);

            const ping: PingResult = { rttMs, srtMs, catMs, timestamp: new Date() };

            setPingHistory((prev) => {
                const updated = [...prev, ping].slice(-PING_HISTORY_SIZE);
                setCurrentRtt(ping.rttMs);
                setCurrentSrt(ping.srtMs);
                setCurrentCat(ping.catMs);
                return updated;
            });
        } catch {
            setCarConnected(false);
        }
    }, [carId, controlConnection]);

    useEffect(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
        if (carId && controlConnection) {
            sendPing();
            intervalRef.current = setInterval(sendPing, pingIntervalMs);
        }
        return () => {
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
            }
        };
    }, [sendPing, carId, controlConnection, pingIntervalMs]);

    const getLatencyColor = (ms: number | null) => {
        if (ms === null) return "text-gray-400";
        if (ms < 30) return "text-green-400";
        if (ms < 150) return "text-yellow-400";
        return "text-red-400";
    };

    if (!carId) {
        return (
            <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-sm">
                <span className="font-bold text-zinc-200">{messages.ping.title}</span>
                <div className="text-zinc-500 text-center py-2 text-xs">{messages.ping.noCarSelected}</div>
            </div>
        );
    }

    const maxBarValue = Math.max(...pingHistory.map((p) => p.rttMs), 1);

    return (
        <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-sm">
            <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-zinc-200">{messages.ping.title}</span>
                <div className="flex items-center gap-2">
                    <select
                        value={pingIntervalMs}
                        onChange={(e) => setPingIntervalMs(Number(e.target.value))}
                        className="bg-zinc-800 border border-zinc-600 rounded text-[10px] text-zinc-300 px-1 py-0.5"
                    >
                        {PING_INTERVALS.map((ms) => (
                            <option key={ms} value={ms}>
                                {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
                            </option>
                        ))}
                    </select>
                    <span className={`text-xs ${carConnected ? "text-green-400" : "text-red-400"}`}>
                        {carConnected ? "●" : "●"}
                    </span>
                </div>
            </div>

            {currentRtt !== null ? (
                <>
                    <div className="grid grid-cols-3 gap-1 mb-2 text-center">
                        <div>
                            <div className="text-zinc-500 text-xs">RTT</div>
                            <div className={`font-mono font-bold text-xs ${getLatencyColor(currentRtt)}`}>
                                {currentRtt}ms
                            </div>
                        </div>
                        <div>
                            <div className="text-zinc-500 text-xs">SRT</div>
                            <div className="font-mono font-bold text-xs text-purple-400">
                                {currentSrt}ms
                            </div>
                        </div>
                        <div>
                            <div className="text-zinc-500 text-xs">CAT</div>
                            <div className="font-mono font-bold text-xs text-yellow-400">
                                {currentCat}ms
                            </div>
                        </div>
                    </div>

                    {currentCat !== null && currentRtt !== null && (() => {
                        const drift = Math.round(currentCat - currentRtt / 2);
                        return Math.abs(drift) > 15 ? (
                            <div className="text-center mb-2 text-[10px] text-amber-400">
                                {messages.ping.clockDrift(drift)}
                            </div>
                        ) : null;
                    })()}

                    {(() => {
                        const chartH = 48;
                        const maxVal = Math.max(...pingHistory.map((p) => Math.max(p.rttMs, p.srtMs, Math.abs(p.catMs))), 1);
                        const w = 200;
                        const stepX = pingHistory.length > 1 ? w / (PING_HISTORY_SIZE - 1) : 0;
                        const y = (val: number) => chartH - (Math.abs(val) / maxVal) * (chartH - 2);

                        const buildLine = (key: keyof PingResult) =>
                            pingHistory
                                .map((p, i) => `${i * stepX},${y(p[key] as number)}`)
                                .join(" ");

                        const avgRtt = pingHistory.reduce((s, p) => s + p.rttMs, 0) / pingHistory.length;
                        const rttColor = avgRtt < 30 ? "#22c55e" : avgRtt < 150 ? "#eab308" : "#ef4444";

                        return (
                            <svg viewBox={`0 0 ${w} ${chartH}`} className="w-full h-12" preserveAspectRatio="none">
                                {/* grid lines */}
                                <line x1="0" y1={chartH / 2} x2={w} y2={chartH / 2} stroke="#3f3f46" strokeWidth="0.5" />
                                <line x1="0" y1={chartH} x2={w} y2={chartH} stroke="#3f3f46" strokeWidth="0.5" />

                                {/* CAT - dashed */}
                                <polyline
                                    fill="none"
                                    stroke="#facc15"
                                    strokeWidth="1.5"
                                    strokeDasharray="4 3"
                                    points={buildLine("catMs")}
                                />
                                {/* SRT - solid */}
                                <polyline
                                    fill="none"
                                    stroke="#a855f7"
                                    strokeWidth="1.5"
                                    points={buildLine("srtMs")}
                                />
                                {/* RTT - solid, color based on avg */}
                                <polyline
                                    fill="none"
                                    stroke={rttColor}
                                    strokeWidth="1.5"
                                    points={buildLine("rttMs")}
                                />
                            </svg>
                        );
                    })()}
                    <div className="flex gap-3 mt-1 text-[9px] text-zinc-500">
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-green-500 rounded-sm" /> RTT
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 bg-purple-500 rounded-sm" /> SRT
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-2 h-0.5 border-t border-dashed border-yellow-400" /> CAT
                        </span>
                    </div>
                </>
            ) : (
                <div className="text-zinc-500 text-center py-2">{messages.ping.waitingFirstPing}</div>
            )}
        </div>
    );
};

export default Ping;
