import React from "react";
import { useI18n } from "@/i18n/provider";

type Props = {
  updatesEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
};

/** Pause while updates are sent; a pulsing play button in the Signal-RC glow while paused. */
export default function UpdatesToggleButton({ updatesEnabled, onToggle, disabled }: Props) {
  const { messages } = useI18n();
  const label = updatesEnabled ? messages.carControl.pauseUpdates : messages.carControl.resumeUpdates;

  return (
    <button
      type="button"
      className={updatesEnabled
        ? "px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40"
        : "updates-resume px-2 py-1 text-xs rounded text-white disabled:opacity-40"}
      title={label}
      aria-label={label}
      aria-pressed={!updatesEnabled}
      disabled={disabled}
      onClick={onToggle}
    >
      {updatesEnabled ? "⏸" : (
        <svg viewBox="0 0 10 10" className="h-3 w-3" aria-hidden="true">
          <path d="M2 1.2 8.6 5 2 8.8Z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}
