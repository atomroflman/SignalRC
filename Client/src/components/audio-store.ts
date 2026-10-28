import { useCallback, useEffect, useState } from 'react';
import { create } from 'zustand';

// Shared push-to-talk state: the vehicle audio player mutes while the driver talks (half-duplex),
// so the driver doesn't hear their own voice coming back through the vehicle mic.
type PushToTalkState = {
  talking: boolean;
  setTalking: (talking: boolean) => void;
};

export const usePushToTalkStore = create<PushToTalkState>((set) => ({
  talking: false,
  setTalking: (talking) => set({ talking }),
}));

/** Car-level audio settings as stored on the server (SignalRC.Shared.Audio.AudioSettings). */
export type CarAudioSettings = {
  inputDevice: string | null;
  inputChannel: 'mix' | 'left' | 'right';
  inputGain: number;
  denoise: boolean;
  bitrateKbps: number;
  outputDevice: string | null;
  outputVolume: number;
  muteInputWhileTalking: boolean;
};

export const DEFAULT_CAR_AUDIO_SETTINGS: CarAudioSettings = {
  inputDevice: null,
  inputChannel: 'mix',
  inputGain: 1,
  denoise: false,
  bitrateKbps: 32,
  outputDevice: null,
  outputVolume: 1,
  muteInputWhileTalking: true,
};

/**
 * Car-level audio settings. `inputDevice` null hides listening, `outputDevice` null hides
 * push-to-talk. `settings` is undefined while loading.
 */
export function useCarAudioSettings(carId?: number) {
  const [settings, setSettings] = useState<CarAudioSettings | undefined>(undefined);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (carId == null) {
      setSettings(undefined);
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${carId}/channels/audio-settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((loaded) => {
        if (!cancelled) setSettings({ ...DEFAULT_CAR_AUDIO_SETTINGS, ...(loaded ?? {}) });
      })
      .catch(() => {
        if (!cancelled) setSettings({ ...DEFAULT_CAR_AUDIO_SETTINGS });
      });
    return () => {
      cancelled = true;
    };
  }, [carId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  return {
    settings,
    inputDevice: settings?.inputDevice ?? null,
    outputDevice: settings?.outputDevice ?? null,
    reload,
  };
}

/** Per-browser number preference (volume, gain) in localStorage; blocked storage just isn't remembered. */
export function useStoredNumber(key: string, fallback: number) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw == null ? NaN : Number(raw);
      if (Number.isFinite(parsed)) setValue(parsed);
    } catch {
      // Storage blocked (private mode).
    }
  }, [key]);

  const update = useCallback(
    (next: number) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Storage blocked (private mode).
      }
    },
    [key],
  );

  return [value, update] as const;
}
