import React, { JSX, useEffect, useRef, useState } from "react";
import { useControlFlowStore } from "./control-flow-store";
import CollapsibleSection from "./collapsible-section";
import type { VideoSettingsPayload, VideoStreamInfo, VideoStreamMapItem } from "@/types/video-stream";
import { useI18n } from "@/i18n/provider";

type VideoSettingsState = VideoSettingsPayload & {
  resolutionMode?: 'preset'|'custom';
};

const STREAM_REFRESH_EVENT = 'videoStreams:refresh';

export default function VideoSettingsControl(props: { carId?: number; canManageEnabled?: boolean } = {}): JSX.Element {
  const { messages } = useI18n();
  const carIdFromStore = useControlFlowStore(state => state.carId);
  const carId = props.carId ?? carIdFromStore;

  const [videoConnection, setVideoConnection] = useState<any>(undefined);

  const [streams, setStreams] = useState<VideoStreamMapItem[]>([]);
  const [settingsMap, setSettingsMap] = useState<Record<number, VideoSettingsState>>({});
  const settingsMapRef = useRef<Record<number, VideoSettingsState>>({});
  const loadedCarIdRef = useRef<number | undefined>(undefined);
  const [busyMap, setBusyMap] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function loadStreams(hub: any, nextCarId: number) {
    const list = await hub.invoke('GetVideoStreamsForCar', nextCarId) as VideoStreamMapItem[];
    setStreams(list);

    // const map: Record<number, VideoSettingsState> = {};
    // list.forEach(stream => {
    //   map[stream.serverId] = {
    //     width: stream.width,
    //     height: stream.height,
    //     framerate: stream.framerate,
    //     bitrateKbps: stream.bitrateKbps,
    //     brightness: stream.brightness,
    //     gain: stream.gain ?? null,
    //     shutter: stream.shutter ?? null,
    //     contrast: stream.contrast ?? null,
    //     ev: stream.ev ?? null,
    //     exposure: stream.exposure ?? 'normal',
    //     resolutionMode: 'preset'
    //   };
    // });
    // setSettingsMap(current => {
    //   const next: Record<number, VideoSettingsState> = {};
    //   list.forEach(stream => {
    //     next[stream.serverId] = current[stream.serverId] ?? map[stream.serverId];
    //   });
    //   settingsMapRef.current = next;
    //   return next;
    // });
  }

  useEffect(() => {
    setError(null);
    if (!carId) {
      setStreams([]);
      setSettingsMap({});
      settingsMapRef.current = {};
      loadedCarIdRef.current = undefined;
      return;
    }

    if (loadedCarIdRef.current !== carId) {
      loadedCarIdRef.current = carId;
      settingsMapRef.current = {};
      setSettingsMap({});
    }

    // Prefer the dedicated CarVideoHub connection when available
    const hub = videoConnection;
    if (hub) {
      void loadStreams(hub, carId);
      return;
    }
  }, [videoConnection, carId]);

  useEffect(() => {
    if (!videoConnection || !carId) {
      return;
    }

    const refresh = () => {
      void loadStreams(videoConnection, carId);
    };

    window.addEventListener(STREAM_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(STREAM_REFRESH_EVENT, refresh);
  }, [carId, videoConnection]);

  // Manage lifecycle of the CarVideoHub connection (component-local)
  useEffect(() => {
    let mounted = true;
    let conn: any;
    (async () => {
      try {
        const signalR = await import("@microsoft/signalr");
        conn = new signalR.HubConnectionBuilder()
          .withUrl('/hubs/connection')
          .withAutomaticReconnect()
          .build();

        await conn.start();
        if (!mounted) {
          try { await conn.stop(); } catch {}
          return;
        }
        setVideoConnection(conn);
      } catch (err) {
        // If we fail to create a video hub connection, leave videoConnection undefined
        console.debug('Failed to start video hub connection:', err);
      }
    })();

    return () => {
      mounted = false;
      if (conn) {
        try { conn.stop(); } catch {}
      }
      setVideoConnection(undefined);
    };
  }, []);

  const resolutionPresets = [
    { key: '1920x1080', w: 1920, h: 1080 },
    { key: '1280x720', w: 1280, h: 720 },
    { key: '800x600', w: 800, h: 600 },
    { key: '640x480', w: 640, h: 480 },
    { key: '3840x2160', w: 3840, h: 2160 },
    { key: 'custom', w: null, h: null }
  ];

  function updateFieldFor(serverId: number, key: keyof VideoSettingsPayload, value: number | string) {
    const current = settingsMapRef.current;
    const next = {
      ...current,
      [serverId]: { ...(current[serverId] || {}), [key]: value }
    };
    settingsMapRef.current = next;
    setSettingsMap(next);
  }

  async function handleSave(serverId: number) {
    setError(null);
    const cfg = settingsMapRef.current[serverId];
    if (!cfg)
      return setError(messages.videoSettings.noSettingsForStream);
    setBusyMap(b => ({ ...b, [serverId]: true }));
    const stream = streams.find(x => x.serverId === serverId);
    if (!stream)
      return setError(messages.videoSettings.noSettingsForStream);
    const payload: VideoStreamMapItem = {
      ...stream,
      width: cfg.width,
      height: cfg.height,
      framerate: cfg.framerate,
      bitrate: cfg.bitrate,
      brightness: cfg.brightness,
      gain: cfg.gain ?? null,
      shutter: cfg.shutter ?? null,
      contrast: cfg.contrast ?? null,
      ev: cfg.ev ?? null,
      exposure: cfg.exposure ?? 'normal',
    };

    try {
      const hub = videoConnection;
      if (hub) {
        await hub.invoke('ChangeVideoStreamSettings', serverId, payload);
      }
    } catch (e) {
      console.error('Failed to save stream settings:', e);
      setError(messages.videoSettings.saveFailed);
    } finally {
      if (videoConnection && carId) {
        await loadStreams(videoConnection, carId);
      }
      window.dispatchEvent(new Event(STREAM_REFRESH_EVENT));
      setBusyMap(b => ({ ...b, [serverId]: false }));
    }
  }

  async function handleEnable(streamId: number, enabled: boolean) {
    if (!carId) {
      return;
    }

    setBusyMap(b => ({ ...b, [streamId]: true }));
    try {
      const hub = videoConnection;
      if (hub) {
        await hub.invoke('SetVideoStreamEnabled', carId, streamId, enabled);
      }
    } catch (toggleError) {
      console.error('Failed to change enabled state:', toggleError);
      setError(messages.videoSettings.toggleEnabledFailed);
    } finally {
      if (videoConnection && carId) {
        await loadStreams(videoConnection, carId);
      }
      window.dispatchEvent(new Event(STREAM_REFRESH_EVENT));
      setBusyMap(b => ({ ...b, [streamId]: false }));
    }
  }

  async function handleStartStream(streamId: number) {
    setBusyMap(b => ({ ...b, [streamId]: true }));
    try {
      const hub = videoConnection;
      if (hub) {
        await hub.invoke('ActivateStream', streamId);
      }
    } catch (startError) {
      console.error('Failed to start stream:', startError);
      setError(messages.videoSettings.startStreamFailed);
    } finally {
      if (videoConnection && carId) {
        await loadStreams(videoConnection, carId);
      }
      window.dispatchEvent(new Event(STREAM_REFRESH_EVENT));
      setBusyMap(b => ({ ...b, [streamId]: false }));
    }
  }

  async function handleStopStream(streamId: number) {
    setBusyMap(b => ({ ...b, [streamId]: true }));
    try {
      const hub = videoConnection;
      if (hub) {
        await hub.invoke('DeactivateStream', streamId);
      }
    } catch (stopError) {
      console.error('Failed to stop stream:', stopError);
      setError(messages.videoSettings.stopStreamFailed);
    } finally {
      if (videoConnection && carId) {
        await loadStreams(videoConnection, carId);
      }
      window.dispatchEvent(new Event(STREAM_REFRESH_EVENT));
      setBusyMap(b => ({ ...b, [streamId]: false }));
    }
  }

  return (
    <CollapsibleSection title={messages.videoSettings.title} label={messages.videoSettings.title} defaultCollapsed={true} className="px-2">
      <div className="space-y-2 text-xs leading-tight">
        {streams.length === 0 && <div className="text-zinc-400">{messages.videoSettings.noStreams}</div>}

        {streams.map(s => {
          const cfg = settingsMap[s.serverId] || {};
          const presetValue = cfg.resolutionMode === 'custom' ? 'custom' : ((cfg.width ?? s.width) && (cfg.height ?? s.height) ? `${cfg.width ?? s.width}x${cfg.height ?? s.height}` : '');

          return (
            <div key={s.serverId} className="mb-2 p-2 bg-zinc-800 border border-zinc-700 rounded">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-zinc-100">{s.name} <span className="text-[11px] text-zinc-400">(#{s.serverId})</span></div>
                <div className="text-[11px] text-zinc-400">{s.location || s.type || messages.common.streamFallback}</div>
              </div>

              <div className="mb-2 flex items-center gap-2 text-[11px] text-zinc-400">
                <span>{s.enabled ? messages.common.enabled : messages.common.disabled}</span>
                <span>·</span>
                <span>{s.isActive ? messages.common.live : messages.common.idle}</span>
                <span>·</span>
                <span>{messages.videoSettings.viewers(s.viewerCount)}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div>
                  <label className="block text-xs text-zinc-300">{messages.videoSettings.resolution}</label>
                  <select className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={presetValue} onChange={e => {
                    const val = e.target.value;
                    if (val === 'custom') {
                      const current = settingsMapRef.current[s.serverId] || {};
                      const next = { ...settingsMapRef.current, [s.serverId]: { ...current, resolutionMode: 'custom' as const, width: current.width ?? s.width, height: current.height ?? s.height } };
                      settingsMapRef.current = next;
                      setSettingsMap(next);
                    } else {
                      const [w,h] = val.split('x').map(Number);
                      const current = settingsMapRef.current[s.serverId] || {};
                      const next = { ...settingsMapRef.current, [s.serverId]: { ...current, resolutionMode: 'preset' as const, width: w, height: h } };
                      settingsMapRef.current = next;
                      setSettingsMap(next);
                    }
                  }} onBlur={() => void handleSave(s.serverId)}>
                    {resolutionPresets.map(p => (
                      <option key={p.key} value={p.key === 'custom' ? 'custom' : `${p.w}x${p.h}`}>{p.key === 'custom' ? `${messages.common.custom}...` : `${p.w}×${p.h}`}</option>
                    ))}
                  </select>

                  {cfg.resolutionMode === 'custom' && (
                    <div className="mt-1 flex gap-1">
                      <input type="number" className="w-1/2 text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.width ?? ''} onChange={e => updateFieldFor(s.serverId, 'width', e.target.value ? Number(e.target.value) : s.width)} onBlur={() => void handleSave(s.serverId)} placeholder={messages.common.width} />
                      <input type="number" className="w-1/2 text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.height ?? ''} onChange={e => updateFieldFor(s.serverId, 'height', e.target.value ? Number(e.target.value) : s.height)} onBlur={() => void handleSave(s.serverId)} placeholder={messages.common.height} />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.framerate}</label>
                  <input type="number" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.framerate ?? s.framerate ?? ''} onChange={e => updateFieldFor(s.serverId, 'framerate', e.target.value ? Number(e.target.value) : s.framerate)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.bitrateKbps}</label>
                  <input type="number" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.bitrate ?? s.bitrate ?? ''} onChange={e => updateFieldFor(s.serverId, 'bitrate', e.target.value ? Number(e.target.value) : 0)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.brightness}</label>
                  <input type="range" min="0" max="100" className="w-full" value={Math.round(((cfg.brightness ?? s.brightness ?? 0.5) as number) * 100)} onChange={e => updateFieldFor(s.serverId, 'brightness', Number(e.target.value) / 100)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.exposure ?? 'Exposure'}</label>
                  <select className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.exposure ?? s.exposure ?? 'normal'} onChange={e => updateFieldFor(s.serverId, 'exposure', e.target.value)} onBlur={() => void handleSave(s.serverId)}>
                    <option value="normal">normal</option>
                    <option value="short">short</option>
                    <option value="long">long</option>
                    <option value="custom">custom</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.gain ?? 'Gain'}</label>
                  <input type="number" step="0.1" min="0" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.gain ?? s.gain ?? ''} onChange={e => updateFieldFor(s.serverId, 'gain', e.target.value ? Number(e.target.value) : null as any)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.shutter ?? 'Shutter (µs)'}</label>
                  <input type="number" min="0" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.shutter ?? s.shutter ?? ''} onChange={e => updateFieldFor(s.serverId, 'shutter', e.target.value ? Number(e.target.value) : null as any)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.contrast ?? 'Contrast'}</label>
                  <input type="number" step="0.1" min="0" max="16" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.contrast ?? s.contrast ?? ''} onChange={e => updateFieldFor(s.serverId, 'contrast', e.target.value ? Number(e.target.value) : null as any)} onBlur={() => void handleSave(s.serverId)} />
                </div>

                <div>
                  <label className="block text-xs text-zinc-300">{messages.common.ev ?? 'EV'}</label>
                  <input type="number" step="0.1" min="-10" max="10" className="w-full text-xs p-1 rounded bg-zinc-900 border border-zinc-700 text-zinc-100" value={cfg.ev ?? s.ev ?? ''} onChange={e => updateFieldFor(s.serverId, 'ev', e.target.value ? Number(e.target.value) : null as any)} onBlur={() => void handleSave(s.serverId)} />
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button className="px-2 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100" onClick={() => handleSave(s.serverId)} disabled={busyMap[s.serverId]}>{busyMap[s.serverId] ? '...' : messages.videoSettings.save}</button>
                {props.canManageEnabled && (
                  <button
                    className={`px-2 py-1 text-xs rounded text-zinc-100 ${s.enabled ? 'bg-amber-700 hover:bg-amber-600' : 'bg-green-700 hover:bg-green-600'}`}
                    onClick={() => handleEnable(s.serverId, !s.enabled)}
                    disabled={busyMap[s.serverId]}
                  >
                    {s.enabled ? messages.videoSettings.disable : messages.videoSettings.enable}
                  </button>
                )}
                {s.enabled && (
                  <>
                    <button
                      className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-zinc-100"
                      onClick={() => handleStartStream(s.serverId)}
                      disabled={busyMap[s.serverId]}
                    >
                      {messages.videoSettings.startStream}
                    </button>
                    <button
                      className="px-2 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-zinc-100"
                      onClick={() => handleStopStream(s.serverId)}
                      disabled={busyMap[s.serverId]}
                    >
                      {messages.videoSettings.stopStream}
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {error && <div className="text-red-600 text-sm">{error}</div>}
        {!props.canManageEnabled && carId && (
          <div className="text-[11px] text-zinc-400">
            {messages.videoSettings.toggleEnabledHint}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
