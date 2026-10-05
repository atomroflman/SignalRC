import { useEffect, useState } from 'react';
import { create } from 'zustand';

// Shared push-to-talk state: the video stream mutes the vehicle audio while the driver talks
// (half-duplex), so the driver doesn't hear their own voice coming back through the vehicle mic.
type PushToTalkState = {
  talking: boolean;
  setTalking: (talking: boolean) => void;
};

export const usePushToTalkStore = create<PushToTalkState>((set) => ({
  talking: false,
  setTalking: (talking) => set({ talking }),
}));

/**
 * Car-level audio settings. `outputDevice` is the vehicle speaker for push-to-talk;
 * null means push-to-talk is not configured and its UI is hidden. Undefined while loading.
 */
export function useCarAudioSettings(carId?: number) {
  const [outputDevice, setOutputDevice] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (carId == null) {
      setOutputDevice(undefined);
      return;
    }
    let cancelled = false;
    fetch(`/api/cars/${carId}/channels/audio-settings`)
      .then((r) => (r.ok ? r.json() : null))
      .then((settings) => {
        if (!cancelled) setOutputDevice(settings?.outputDevice ?? null);
      })
      .catch(() => {
        if (!cancelled) setOutputDevice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [carId]);

  return { outputDevice };
}
