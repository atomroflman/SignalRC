'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Janus,
  JanusPluginHandle,
  JanusPluginOptions,
  JanusStatic,
  JanusStreamInfo,
  JanusStreamingMessage,
} from '@/types/janus';
import { useI18n } from '@/i18n/provider';
import type { Messages } from '@/i18n/translations';

interface VideoStreamProps {
  streamId?: number;
  streamName?: string;
  audioEnabled?: boolean;
  audioInputDeviceId?: string;
  onAudioTrack?: (track: MediaStreamTrack | null) => void;
}

const JANUS_SERVERS = ['/janus', '/janus-ws'];
const JANUS_SCRIPT_ID = 'janus-gateway-sdk-script';
const NO_DATA_THRESHOLD_MS = 5000;
const INITIAL_RETRY_DELAY_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;

type Phase =
  | 'idle'
  | 'loading-script'
  | 'initializing'
  | 'connecting'
  | 'signed-in'
  | 'attached'
  | 'listing'
  | 'watching'
  | 'negotiating'
  | 'receiving'
  | 'waiting-for-vehicle'
  | 'error'
  | 'closed';

function parseBitrate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const numeric = parseFloat(trimmed.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(numeric)) return null;

  if (lower.includes('mbit')) {
    return numeric * 1_000_000;
  }
  if (lower.includes('kbit') || lower.includes('kbps')) {
    return numeric * 1_000;
  }
  if (lower.includes('bit')) {
    return numeric;
  }

  return numeric;
}

function formatBitrate(bits: number | null): string {
  if (bits === null || !Number.isFinite(bits)) {
    return '--';
  }
  if (bits >= 1_000_000) {
    return `${(bits / 1_000_000).toFixed(2)} Mbit/s`;
  }
  return `${(bits / 1_000).toFixed(0)} kbit/s`;
}

function loadJanusScript(
  browserRequiredMessage: string,
  janusUnavailableMessage: string,
  janusScriptFailedMessage: string,
): Promise<JanusStatic> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error(browserRequiredMessage));
      return;
    }

    if (window.Janus) {
      resolve(window.Janus);
      return;
    }

    const existing = document.getElementById(JANUS_SCRIPT_ID) as HTMLScriptElement | null;

    const cleanup = (script: HTMLScriptElement) => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };

    const onLoad = () => {
      const script = document.getElementById(JANUS_SCRIPT_ID) as HTMLScriptElement | null;
      if (script) {
        cleanup(script);
      }
      if (window.Janus) {
        resolve(window.Janus);
      } else {
        reject(new Error(janusUnavailableMessage));
      }
    };

    const onError = () => {
      const script = document.getElementById(JANUS_SCRIPT_ID) as HTMLScriptElement | null;
      if (script) {
        cleanup(script);
      }
      reject(new Error(janusScriptFailedMessage));
    };

    const script = existing ?? document.createElement('script');
    script.id = JANUS_SCRIPT_ID;
    script.async = true;
    script.src = '/janus.js';
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (!existing) {
      document.body.appendChild(script);
    }
  });
}

function initJanus(JanusCtor: JanusStatic): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      JanusCtor.init({
        debug: 'all',
        dependencies: JanusCtor.useDefaultDependencies(),
        callback: () => resolve(),
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function fetchIceServers(): Promise<RTCIceServer[] | undefined> {
  try {
    const res = await fetch('/api/webrtc/ice-servers');
    if (!res.ok) return undefined;
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(data.iceServers) ? data.iceServers : undefined;
  } catch {
    return undefined;
  }
}

function createJanusSession(
  JanusCtor: JanusStatic,
  servers: string[],
  iceServers?: RTCIceServer[],
): Promise<Janus> {
  return new Promise((resolve, reject) => {
    const janus = new JanusCtor({
      server: servers,
      iceServers,
      success: () => resolve(janus),
      error: (err: string) => reject(new Error(err)),
      destroyed: () => {
        // Lifecycle-Callback; Fehlerbehandlung erfolgt im Hook.
      },
    });
  });
}

function attachStreamingPlugin(
  janus: Janus,
  handlers: Pick<JanusPluginOptions, 'onmessage' | 'onremotetrack'>,
): Promise<JanusPluginHandle> {
  return new Promise((resolve, reject) => {
    janus.attach({
      plugin: 'janus.plugin.streaming',
      success: (handle) => resolve(handle),
      error: (err: string) => reject(new Error(err)),
      onmessage: handlers.onmessage,
      onremotetrack: handlers.onremotetrack,
    });
  });
}

function listJanusStreams(handle: JanusPluginHandle): Promise<JanusStreamInfo[]> {
  return new Promise((resolve, reject) => {
    handle.send({
      message: { request: 'list' },
      success: (msg: JanusStreamingMessage) => {
        if (msg.streaming === 'list') {
          resolve(msg.list ?? []);
        } else {
          resolve([]);
        }
      },
      error: (err: string) => reject(new Error(err)),
    });
  });
}

function watchStream(handle: JanusPluginHandle, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.send({
      message: { request: 'watch', id },
      success: () => resolve(),
      error: (err: string) => reject(new Error(err)),
    });
  });
}

function createAnswerAndStart(
  handle: JanusPluginHandle,
  jsep: RTCSessionDescriptionInit,
): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.createAnswer({
      jsep,
      media: { audioSend: false, videoSend: false },
      success: (answer) => {
        handle.send({
          message: { request: 'start' },
          jsep: answer,
          success: () => resolve(),
          error: (err: string) => reject(new Error(err)),
        });
      },
      error: (err: string) => reject(new Error(err)),
    });
  });
}

function getPhaseClasses(phase: Phase): string {
  switch (phase) {
    case 'receiving':
      return 'bg-green-700/90';
    case 'error':
      return 'bg-red-700/90';
    case 'waiting-for-vehicle':
      return 'bg-amber-700/90';
    case 'idle':
    case 'closed':
      return 'bg-zinc-700/90';
    default:
      return 'bg-blue-700/90';
  }
}

function getPhaseMessage(
  phase: Phase,
  streamId: number | undefined,
  messages: Messages,
): string {
  switch (phase) {
    case 'idle':
      return messages.videoStream.noStreamSelected;
    case 'loading-script':
      return messages.videoStream.initializing;
    case 'initializing':
      return messages.videoStream.initializing;
    case 'connecting':
      return messages.videoStream.connectingToJanus;
    case 'signed-in':
      return messages.videoStream.signedInToJanus;
    case 'attached':
      return messages.videoStream.connectedLoadingPlugin;
    case 'listing':
      return messages.videoStream.listingStreams;
    case 'watching':
      return streamId !== undefined
        ? messages.videoStream.startingStream(streamId)
        : messages.videoStream.pluginReady;
    case 'negotiating':
      return messages.videoStream.negotiating;
    case 'receiving':
      return messages.videoStream.streamActive;
    case 'waiting-for-vehicle':
      return messages.videoStream.waitingForVehicle;
    case 'closed':
      return messages.videoStream.connectionClosed;
    case 'error':
    default:
      return messages.videoStream.errorState;
  }
}

function getSendingMessage(
  phase: Phase,
  vehicleSending: boolean,
  messages: Messages,
): string {
  if (phase === 'receiving' && vehicleSending) {
    return messages.videoStream.vehicleSending;
  }
  if (phase === 'waiting-for-vehicle') {
    return messages.videoStream.vehicleNotSending;
  }
  return messages.videoStream.waitingForVehicle;
}

interface UseJanusStreamingResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  phase: Phase;
  error: string | null;
  janusStreams: JanusStreamInfo[];
  stats: { bitrate: number | null; fps: number | null };
  vehicleSending: boolean;
  retryInfo: { attempt: number; remainingMs: number } | null;
}

function useJanusStreaming(
  streamId: number | undefined,
  onAudioTrack?: (track: MediaStreamTrack | null) => void,
): UseJanusStreamingResult {
  const { messages } = useI18n();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [janusStreams, setJanusStreams] = useState<JanusStreamInfo[]>([]);
  const [stats, setStats] = useState<{ bitrate: number | null; fps: number | null }>({
    bitrate: null,
    fps: null,
  });
  const [vehicleSending, setVehicleSending] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [retryInfo, setRetryInfo] = useState<{ attempt: number; remainingMs: number } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const janusRef = useRef<Janus | null>(null);
  const pluginHandleRef = useRef<JanusPluginHandle | null>(null);
  const lastDataRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const retryTimeoutRef = useRef<number | null>(null);
  const retryCountdownRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const lastStreamIdRef = useRef<number | undefined>(undefined);

  const markDataReceived = useCallback(() => {
    lastDataRef.current = Date.now();
    setVehicleSending(true);
    setPhase((current) => (current === 'waiting-for-vehicle' ? 'receiving' : current));
  }, []);

  const resetMedia = useCallback(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }, []);

  const cleanupJanus = useCallback(() => {
    if (pluginHandleRef.current) {
      try {
        pluginHandleRef.current.detach();
      } catch (detachError) {
        console.warn('Janus detach error:', detachError);
      }
      pluginHandleRef.current = null;
    }
    if (janusRef.current) {
      try {
        janusRef.current.destroy({ cleanupHandles: true });
      } catch (destroyError) {
        console.warn('Janus destroy error:', destroyError);
      }
      janusRef.current = null;
    }
    resetMedia();
  }, [resetMedia]);

  const scheduleRetry = useCallback(() => {
    if (retryTimeoutRef.current) return;
    retryAttemptRef.current += 1;
    const delay = Math.min(
      INITIAL_RETRY_DELAY_MS * 2 ** (retryAttemptRef.current - 1),
      MAX_RETRY_DELAY_MS,
    );
    setRetryInfo({ attempt: retryAttemptRef.current, remainingMs: delay });
    retryTimeoutRef.current = window.setTimeout(() => {
      retryTimeoutRef.current = null;
      if (!mountedRef.current) return;
      setRetryVersion((v) => v + 1);
      setRetryInfo(null);
    }, delay);
  }, []);

  const handleError = useCallback(
    (message: string) => {
      if (!mountedRef.current) return;
      setError(message);
      setPhase('error');
      scheduleRetry();
    },
    [scheduleRetry],
  );

  const resetRetryState = useCallback(() => {
    retryAttemptRef.current = 0;
    setRetryInfo(null);
    if (retryTimeoutRef.current) {
      window.clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  // Countdown für den nächsten Retry aktualisieren.
  useEffect(() => {
    if (!retryInfo) return;
    retryCountdownRef.current = window.setInterval(() => {
      setRetryInfo((info) => {
        if (!info) return null;
        const remaining = info.remainingMs - 1000;
        return remaining <= 0 ? null : { ...info, remainingMs: remaining };
      });
    }, 1000);
    return () => {
      if (retryCountdownRef.current) {
        window.clearInterval(retryCountdownRef.current);
        retryCountdownRef.current = null;
      }
    };
  }, [retryInfo]);

  // Haupteffekt: Janus laden, anmelden, Stream suchen und watch starten.
  useEffect(() => {
    mountedRef.current = true;
    cleanupJanus();
    if (lastStreamIdRef.current !== streamId) {
      lastStreamIdRef.current = streamId;
      resetRetryState();
    }
    setError(null);
    setJanusStreams([]);
    setStats({ bitrate: null, fps: null });
    setVehicleSending(false);
    lastDataRef.current = 0;

    if (streamId === undefined) {
      setPhase('idle');
      resetMedia();
      return () => {
        mountedRef.current = false;
      };
    }

    setPhase('loading-script');

    const setup = async () => {
      try {
        const JanusCtor = await loadJanusScript(
          messages.videoStream.browserRequired,
          messages.videoStream.janusUnavailable,
          messages.videoStream.janusScriptFailed,
        );
        if (!mountedRef.current) return;

        if (!JanusCtor.isWebrtcSupported()) {
          handleError(messages.videoStream.webRtcNotSupported);
          return;
        }

        setPhase('initializing');
        await initJanus(JanusCtor);
        if (!mountedRef.current) return;

        setPhase('connecting');
        const iceServers = await fetchIceServers();
        const janus = await createJanusSession(JanusCtor, JANUS_SERVERS, iceServers);
        if (!mountedRef.current) {
          janus.destroy({ cleanupHandles: true });
          return;
        }
        janusRef.current = janus;
        setPhase('signed-in');

        const handleRemoteTrack = (track: MediaStreamTrack, mid: string, on: boolean) => {
          if (!mountedRef.current) return;
          if (on && track.kind === 'video') {
            const stream = new MediaStream([track]);
            if (videoRef.current) {
              videoRef.current.srcObject = stream;
            }
            resetRetryState();
            markDataReceived();
            setPhase('receiving');
            setError(null);
          } else if (on && track.kind === 'audio') {
            const audioStream = new MediaStream([track]);
            if (audioRef.current) {
              audioRef.current.srcObject = audioStream;
            }
            onAudioTrack?.(track);
            markDataReceived();
          } else if (!on && track.kind === 'audio') {
            if (audioRef.current) {
              audioRef.current.srcObject = null;
            }
            onAudioTrack?.(null);
          }
        };

        const handleMessage = (msg: JanusStreamingMessage, jsep?: RTCSessionDescriptionInit) => {
          if (!mountedRef.current) return;

          if (msg.error) {
            handleError(msg.error);
            return;
          }

          if (msg.streaming === 'event' && msg.result?.status) {
            const status = msg.result.status.toLowerCase();
            if (['stopped', 'destroyed', 'offline'].includes(status)) {
              setPhase('waiting-for-vehicle');
              setVehicleSending(false);
            } else if (['started', 'live'].includes(status)) {
              resetRetryState();
              setPhase('receiving');
              setVehicleSending(true);
            }
          }

          if (jsep && pluginHandleRef.current) {
            setPhase('negotiating');
            createAnswerAndStart(pluginHandleRef.current, jsep).catch((err: Error) => {
              if (!mountedRef.current) return;
              handleError(messages.videoStream.webRtcError(err.message));
            });
          }
        };

        setPhase('attached');
        const handle = await attachStreamingPlugin(janus, {
          onmessage: handleMessage,
          onremotetrack: handleRemoteTrack,
        });
        if (!mountedRef.current) {
          handle.detach();
          return;
        }
        pluginHandleRef.current = handle;

        setPhase('listing');
        const streams = await listJanusStreams(handle);
        if (!mountedRef.current) return;
        setJanusStreams(streams);

        const match = streams.find((s) => s.id === streamId);
        if (!match) {
          handleError(messages.videoStream.configuredStreamMissing(streamId));
          return;
        }

        setPhase('watching');
        await watchStream(handle, streamId);
        if (!mountedRef.current) return;
        setPhase('negotiating');
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        handleError(message);
      }
    };

    setup();

    return () => {
      mountedRef.current = false;
      cleanupJanus();
      if (retryTimeoutRef.current) {
        window.clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };
  }, [
    streamId,
    retryVersion,
    messages,
    onAudioTrack,
    markDataReceived,
    resetMedia,
    cleanupJanus,
    handleError,
    resetRetryState,
  ]);

  // Statistiken auslesen und erkennen, ob das Fahrzeug noch sendet.
  useEffect(() => {
    if (
      !pluginHandleRef.current ||
      (phase !== 'receiving' &&
        phase !== 'negotiating' &&
        phase !== 'watching' &&
        phase !== 'waiting-for-vehicle')
    ) {
      return;
    }

    let cancelled = false;
    let noDataTimer: number | null = null;

    const checkNoData = () => {
      if (cancelled) return;
      const elapsed = Date.now() - lastDataRef.current;
      if (elapsed > NO_DATA_THRESHOLD_MS && vehicleSending) {
        setVehicleSending(false);
        setPhase('waiting-for-vehicle');
      }
    };

    const updateStats = async () => {
      const handle = pluginHandleRef.current;
      if (!handle || cancelled) return;

      if (typeof handle.getBitrate === 'function') {
        const raw = handle.getBitrate();
        const parsed = parseBitrate(raw);
        if (!cancelled && parsed !== null) {
          setStats((prev) => ({ ...prev, bitrate: parsed }));
          if (parsed > 0) {
            markDataReceived();
          }
        }
      }

      const pc = (handle as unknown as { webrtcStuff?: { pc?: RTCPeerConnection } }).webrtcStuff
        ?.pc;
      if (!pc || typeof pc.getStats !== 'function') {
        return;
      }

      try {
        const reports = await pc.getStats();
        if (cancelled) return;

        let fpsValue: number | null = null;
        reports.forEach((report: any) => {
          if (!report) return;
          if (
            (report.type === 'inbound-rtp' || report.type === 'track') &&
            report.kind === 'video'
          ) {
            if (typeof report.framesPerSecond === 'number') {
              fpsValue = report.framesPerSecond;
            }
          }
        });

        if (fpsValue === null) {
          const stream = videoRef.current?.srcObject;
          const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
          const trackFps = track?.getSettings().frameRate;
          if (typeof trackFps === 'number' && Number.isFinite(trackFps)) {
            fpsValue = trackFps;
          }
        }

        if (!cancelled && fpsValue !== null) {
          setStats((prev) => ({ ...prev, fps: fpsValue }));
          if (fpsValue > 0) {
            markDataReceived();
          }
        }
      } catch (statsError) {
        console.debug('Janus stats error:', statsError);
      }
    };

    updateStats();
    const statsInterval = window.setInterval(updateStats, 2000);
    noDataTimer = window.setInterval(checkNoData, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(statsInterval);
      if (noDataTimer) {
        window.clearInterval(noDataTimer);
      }
    };
  }, [phase, vehicleSending, markDataReceived]);

  return {
    videoRef,
    audioRef,
    phase,
    error,
    janusStreams,
    stats,
    vehicleSending,
    retryInfo,
  };
}

interface JanusStreamListProps {
  streams: JanusStreamInfo[];
  messages: Messages;
}

function JanusStreamList({ streams, messages }: JanusStreamListProps) {
  return (
    <div className="absolute bottom-2 left-2 z-10 max-h-48 overflow-auto rounded bg-black/80 p-2 text-xs text-white">
      <div className="mb-1 font-medium">{messages.videoStream.availableJanusStreams}</div>
      <table className="border-separate border-spacing-x-2">
        <thead>
          <tr className="text-left text-zinc-400">
            <th>{messages.videoStream.streamListId}</th>
            <th>{messages.videoStream.streamListDescription}</th>
            <th>{messages.videoStream.streamListEnabled}</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((stream) => (
            <tr key={stream.id}>
              <td className="pr-3">{stream.id}</td>
              <td className="pr-3">{stream.description || '-'}</td>
              <td>
                {stream.enabled
                  ? messages.common.enabled
                  : messages.common.disabled}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function VideoStream({
  streamId,
  streamName,
  audioEnabled = false,
  onAudioTrack,
}: VideoStreamProps) {
  const { messages } = useI18n();
  const { videoRef, audioRef, phase, error, janusStreams, stats, vehicleSending, retryInfo } =
    useJanusStreaming(streamId, onAudioTrack);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const formattedBitrate = formatBitrate(stats.bitrate);
  const formattedFps =
    typeof stats.fps === 'number' && Number.isFinite(stats.fps)
      ? `${stats.fps.toFixed(1)} fps`
      : '--';

  const showStreamList =
    phase !== 'receiving' &&
    phase !== 'negotiating' &&
    phase !== 'watching' &&
    janusStreams.length > 0;

  const sendingMessage = getSendingMessage(phase, vehicleSending, messages);
  const sendingDotClass =
    phase === 'receiving' && vehicleSending ? 'bg-green-400' : 'bg-red-400';

  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center">
      {overlayVisible && (
        <div
          className={`absolute top-2 left-2 z-10 rounded px-3 py-2 text-sm text-white ${getPhaseClasses(phase)}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div>
                {messages.videoStream.statusLabel}: {getPhaseMessage(phase, streamId, messages)}
                {streamName && ` (${streamName})`}
              </div>
              <div className="flex items-center gap-2 text-xs text-white/90">
                <span className={`inline-block h-2 w-2 rounded-full ${sendingDotClass}`} />
                <span>{sendingMessage}</span>
              </div>
              <div className="text-xs text-white/80">
                {messages.videoStream.streamInfoLabel}: {formattedFps} | {formattedBitrate}
              </div>
              {retryInfo && (
                <div className="text-xs text-white/90">
                  {messages.videoStream.retryIn(Math.ceil(retryInfo.remainingMs / 1000))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="text-xs text-white/70 hover:text-white"
              onClick={() => setOverlayVisible(false)}
              aria-label={messages.videoStream.closeOverlay}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {!overlayVisible && (
        <button
          type="button"
          className="absolute top-2 left-2 z-10 rounded bg-black/60 px-2 py-1 text-xs text-white"
          onClick={() => setOverlayVisible(true)}
        >
          {messages.videoStream.showInfo}
        </button>
      )}
      {error && (
        <div className="absolute top-2 right-2 z-10 rounded bg-red-600/90 px-3 py-1 text-sm text-white">
          <div>
            {messages.videoStream.errorLabel}: {error}
          </div>
          {retryInfo && (
            <div className="text-xs text-white/90">
              {messages.videoStream.retryIn(Math.ceil(retryInfo.remainingMs / 1000))}
            </div>
          )}
        </div>
      )}
      {showStreamList && <JanusStreamList streams={janusStreams} messages={messages} />}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={!audioEnabled}
        className="h-full max-w-full bg-black object-contain"
      />
      <audio ref={audioRef} autoPlay playsInline className={audioEnabled ? 'w-full mt-2' : 'hidden'} />
    </div>
  );
}
