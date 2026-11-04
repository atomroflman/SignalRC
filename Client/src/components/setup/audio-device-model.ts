/** One ALSA device as reported by the vehicle (SignalRC.Shared.Channels.AudioDeviceInfo). */
export type AudioDevice = { name: string; description?: string | null };

export type AudioDeviceKind = 'input' | 'output';

/** Devices the setup page offers first: plughw converts rate and channels, so it opens on any card. */
export function recommendedDevices(devices: AudioDevice[]): AudioDevice[] {
  return devices.filter((d) => d.name.startsWith('plughw:'));
}

/** The other ALSA names of the vehicle, for special cases. */
export function otherDevices(devices: AudioDevice[]): AudioDevice[] {
  return devices.filter((d) => !d.name.startsWith('plughw:'));
}

/** "USB PnP Sound Device, USB Audio" → "USB PnP Sound Device"; the raw name without a description. */
export function deviceLabel(devices: AudioDevice[], name: string): string {
  const description = devices.find((d) => d.name === name)?.description;
  return description?.split(',')[0]?.trim() || name;
}

function cardOf(name: string): string | null {
  return /CARD=([^,]+)/.exec(name)?.[1] ?? null;
}

/**
 * Whether a saved device still exists. A sound card lists under several names (hw:, plughw:, …),
 * so the same card counts even when the saved name is not in the list itself.
 */
export function isDetected(devices: AudioDevice[], name: string): boolean {
  const card = cardOf(name);
  return devices.some((d) => d.name === name || (card != null && cardOf(d.name) === card));
}

/** HDMI outputs exist on every Pi, but rarely have a speaker attached. */
export function isHdmi(device: AudioDevice): boolean {
  return /hdmi/i.test(device.name) || /hdmi/i.test(device.description ?? '');
}

/** Detected sound cards worth suggesting for this direction while nothing is configured for it. */
export function suggestedDevices(devices: AudioDevice[], kind: AudioDeviceKind, configured: string | null): AudioDevice[] {
  if (configured) return [];
  return recommendedDevices(devices).filter((d) => kind === 'input' || !isHdmi(d));
}

/** The first device to preselect in a new entry: a real speaker wins over HDMI. */
export function preselectedDevice(devices: AudioDevice[]): string {
  const recommended = recommendedDevices(devices);
  return (recommended.find((d) => !isHdmi(d)) ?? recommended[0] ?? devices[0])?.name ?? '';
}
