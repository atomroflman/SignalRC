import { describe, expect, it } from 'vitest';
import { deviceLabel, isDetected, otherDevices, preselectedDevice, recommendedDevices, suggestedDevices } from './audio-device-model';

// As reported by the truck.
const inputs = [
  { name: 'plughw:CARD=Device,DEV=0', description: 'USB PnP Sound Device, USB Audio' },
  { name: 'default', description: 'Default Audio Device' },
  { name: 'hw:CARD=Device,DEV=0', description: 'USB PnP Sound Device, USB Audio, Direct hardware device' },
];
const outputs = [
  { name: 'plughw:CARD=vc4hdmi0,DEV=0', description: 'vc4-hdmi-0, MAI PCM i2s-hifi-0' },
  { name: 'plughw:CARD=Speaker,DEV=0', description: 'USB Speaker, USB Audio' },
];

describe('audio device model', () => {
  it('separates recommended devices from other ALSA names', () => {
    expect(recommendedDevices(inputs).map((d) => d.name)).toEqual(['plughw:CARD=Device,DEV=0']);
    expect(otherDevices(inputs).map((d) => d.name)).toEqual(['default', 'hw:CARD=Device,DEV=0']);
  });

  it('labels a device by the first part of its description', () => {
    expect(deviceLabel(inputs, 'plughw:CARD=Device,DEV=0')).toBe('USB PnP Sound Device');
    expect(deviceLabel(inputs, 'plughw:CARD=Gone,DEV=0')).toBe('plughw:CARD=Gone,DEV=0');
  });

  it('recognises a saved device under another name of the same card', () => {
    expect(isDetected(inputs, 'sysdefault:CARD=Device')).toBe(true);
    expect(isDetected(inputs, 'plughw:CARD=Gone,DEV=0')).toBe(false);
    expect(isDetected([], 'plughw:CARD=Device,DEV=0')).toBe(false);
  });

  it('suggests a microphone only while none is configured', () => {
    expect(suggestedDevices(inputs, 'input', null).map((d) => d.name)).toEqual(['plughw:CARD=Device,DEV=0']);
    expect(suggestedDevices(inputs, 'input', 'plughw:CARD=Device,DEV=0')).toEqual([]);
  });

  it('does not suggest HDMI as a speaker, but still prefers a real one when adding', () => {
    expect(suggestedDevices(outputs, 'output', null).map((d) => d.name)).toEqual(['plughw:CARD=Speaker,DEV=0']);
    expect(preselectedDevice(outputs)).toBe('plughw:CARD=Speaker,DEV=0');
    expect(preselectedDevice([outputs[0]])).toBe('plughw:CARD=vc4hdmi0,DEV=0');
    expect(preselectedDevice([])).toBe('');
  });
});
