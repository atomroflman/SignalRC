import React from "react";
import { GamepadAxisChannel } from "./controller-store";
import { useI18n } from "@/i18n/provider";

export default function GamepadAxisCalibration(props: {
    value: GamepadAxisChannel;
    onVauleChange?: (newValue: GamepadAxisChannel) => void;
    index: number;
}) {
    const { messages } = useI18n();
    const decimals = props.value.accuracy;
    const step = 1;
    const min = 0;
    const max = 10;
    const pow = Math.pow(10, -decimals);
    return (
        <div>
            <div className="mb-1 font-semibold text-zinc-200 text-xs">{messages.gamepadAxisCalibration.accuracy}</div>
            <div key={props.index} className="flex items-center mb-1">
                <span className="mr-1 text-zinc-300 text-xs">{messages.gamepadAxisCalibration.axis(props.index)}</span>
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={decimals}
                    onChange={e =>
                        props.onVauleChange?.({...props.value, accuracy: parseInt(e.target.value)})
                    }
                    className="mx-1 accent-blue-400 bg-zinc-800 h-2"
                    style={{ width: 80 }}
                />
                <span className="ml-1 text-zinc-400 text-xs">{messages.gamepadAxisCalibration.decimals(decimals, pow)}</span>
            </div>
        </div>
    );
}
