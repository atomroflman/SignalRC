'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubConnection } from '@microsoft/signalr';
import type { Janus, JanusPluginHandle, JanusStreamingMessage } from '@/types/janus';
import {
  JANUS_SERVERS,
  attachStreamingPlugin,
  createAnswerAndStart,
  createJanusSession,
  fetchIceServers,
  initJanus,
  loadJanusScript,
  watchStream,
} from './janus-client';
import { useCarAudioSettings, useCarAudioStatus, usePushToTalkStore, useStoredNumber } from './audio-store';
import { LevelMeter, useAnalyserLevel } from './level-meter';
import { useI18n } from '@/i18n/provider';

const VOLUME_STORAGE_KEY = 'signalrc.vehicleAudioVolume';
const MAX_VOLUME = 2;
const RETRY_DELAY_MS = 3000;

type ListenPhase = 'off' | 'connecting' | 'waiting' | 'live' | 'no-microphone' | 'error';

/**
 * Plays the car's microphone from its audio-only Janus mountpoint. While `enabled`, this browser is
 * registered as a listener (the server only runs the microphone while someone listens). Playback goes
 * through Web Audio so the volume can go above 100 % and a meter can tap the signal.
 */
function useVehicleAudioPlayer(carId: number | undefined, enabled: boolean, gain: number) {
  const { messages } = useI18n();
  const [phase, setPhase] = useState<ListenPhase>('off');
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const gainNodeRef = useRef<GainNode | null>(null);
  const gainRef = useRef(gain);
  gainRef.current = gain;

  useEffect(() => {
    const node = gainNodeRef.current;
    if (node) node.gain.setTargetAtTime(gain, node.context.currentTime, 0.02);
  }, [gain]);

  useEffect(() => {
    if (!enabled || carId == null) {
      setPhase('off');
      setError(null);
      return;
    }

    let active = true;
    let connection: HubConnection | null = null;
    let janus: Janus | null = null;
    let handle: JanusPluginHandle | null = null;
    let retryTimer: number | null = null;
    // Chromium only renders a remote WebRTC track through Web Audio while a media element plays it too.
    const sink = new Audio();
    sink.muted = true;
    const context = new AudioContext();
    const gainNode = context.createGain();
    gainNode.gain.value = gainRef.current;
    // The meter taps the signal before the local volume: it shows what the vehicle sends.
    const analyserNode = context.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.connect(gainNode);
    gainNode.connect(context.destination);
    gainNodeRef.current = gainNode;
    let source: MediaStreamAudioSourceNode | null = null;

    const retry = () => {
      if (!active || retryTimer != null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (active) setRetryVersion((v) => v + 1);
      }, RETRY_DELAY_MS);
    };

    const fail = (message: string) => {
      if (!active) return;
      setError(message);
      setPhase('error');
      retry();
    };

    const handleRemoteTrack = (track: MediaStreamTrack, _mid: string, on: boolean) => {
      if (!active || track.kind !== 'audio') return;
      source?.disconnect();
      source = null;
      if (!on) {
        sink.srcObject = null;
        setPhase('waiting');
        return;
      }
      const stream = new MediaStream([track]);
      sink.srcObject = stream;
      sink.play().catch(() => {});
      source = context.createMediaStreamSource(stream);
      source.connect(analyserNode);
      void context.resume();
      setError(null);
      setPhase('live');
    };

    const handleMessage = (msg: JanusStreamingMessage, jsep?: RTCSessionDescriptionInit) => {
      if (!active) return;
      if (msg.error) {
        fail(msg.error);
        return;
      }
      const status = msg.result?.status?.toLowerCase();
      if (status && ['stopped', 'destroyed'].includes(status)) {
        // The mountpoint is recreated when the microphone changes; watch it again.
        setPhase('waiting');
        retry();
      }
      if (jsep && handle) {
        createAnswerAndStart(handle, jsep).catch((err: Error) => fail(messages.videoStream.webRtcError(err.message)));
      }
    };

    const setup = async () => {
      setPhase('connecting');
      setError(null);
      try {
        const signalR = await import('@microsoft/signalr');
        connection = new signalR.HubConnectionBuilder().withUrl('/hubs/connection').withAutomaticReconnect().build();
        // A new connection id means the server forgot this listener: register again from scratch.
        connection.onreconnected(() => {
          if (active) setRetryVersion((v) => v + 1);
        });
        await connection.start();
        if (!active) return;

        const mountpointId = (await connection.invoke('StartAudioListening', carId)) as number | null;
        if (!active) return;
        if (mountpointId == null) {
          setPhase('no-microphone');
          return;
        }

        const JanusCtor = await loadJanusScript(
          messages.videoStream.browserRequired,
          messages.videoStream.janusUnavailable,
          messages.videoStream.janusScriptFailed,
        );
        if (!active) return;
        await initJanus(JanusCtor);
        const iceServers = await fetchIceServers();
        janus = await createJanusSession(JanusCtor, JANUS_SERVERS, iceServers);
        if (!active) return;
        handle = await attachStreamingPlugin(janus, { onmessage: handleMessage, onremotetrack: handleRemoteTrack });
        if (!active) return;
        await watchStream(handle, mountpointId);
        if (active) setPhase((p) => (p === 'live' ? p : 'waiting'));
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err));
      }
    };

    setAnalyser(analyserNode);
    void context.resume();
    void setup();

    return () => {
      active = false;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      try {
        handle?.detach();
      } catch {}
      try {
        janus?.destroy({ cleanupHandles: true });
      } catch {}
      if (connection) {
        const conn = connection;
        conn
          .invoke('StopAudioListening', carId)
          .catch(() => {})
          .finally(() => conn.stop().catch(() => {}));
      }
      source?.disconnect();
      sink.srcObject = null;
      gainNodeRef.current = null;
      setAnalyser(null);
      void context.close();
    };
  }, [carId, enabled, retryVersion, messages]);

  return { phase, error, analyser };
}

/**
 * "Listen to the vehicle": toggle, local volume (per browser, up to 200 %) and a level meter.
 * Independent of the video; muted locally while this browser talks via push-to-talk.
 */
export default function VehicleAudio({ carId }: { carId?: number }) {
  const { messages } = useI18n();
  const { inputDevice, settings } = useCarAudioSettings(carId);
  const [listening, setListening] = useState(false);
  const [volume, setVolume] = useStoredNumber(VOLUME_STORAGE_KEY, 1);
  const talking = usePushToTalkStore((state) => state.talking);
  const { phase, error, analyser } = useVehicleAudioPlayer(carId, listening && !!inputDevice, talking ? 0 : volume);
  const level = useAnalyserLevel(analyser);
  // Only while listening: tells why it went quiet (the driver talks and the vehicle mutes its mic).
  const status = useCarAudioStatus(listening ? carId : undefined);

  // Stop listening when switching cars; the next car starts muted like the first one.
  useEffect(() => setListening(false), [carId]);

  const toggle = useCallback(() => setListening((on) => !on), []);

  if (settings && !inputDevice) {
    return <div className="text-xs text-zinc-500">{messages.vehicleAudio.noMicrophone}</div>;
  }

  const statusText =
    phase === 'live'
      ? talking
        ? messages.vehicleAudio.mutedWhileTalking
        : status?.inputMuted
          ? messages.vehicleAudio.mutedByDriver
          : messages.vehicleAudio.live
      : phase === 'connecting'
        ? messages.vehicleAudio.connecting
        : phase === 'waiting'
          ? messages.vehicleAudio.waiting
          : phase === 'no-microphone'
            ? messages.vehicleAudio.noMicrophone
            : phase === 'error'
              ? messages.vehicleAudio.error(error ?? '')
              : messages.vehicleAudio.off;

  return (
    <div className="space-y-2 rounded-lg bg-zinc-800 p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggle}
          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
            listening
              ? 'border-green-700 bg-green-800 text-white'
              : 'border-zinc-600 bg-zinc-700 text-zinc-200 hover:border-zinc-400'
          }`}
        >
          {listening ? `🔊 ${messages.vehicleAudio.listening}` : `🔇 ${messages.vehicleAudio.listen}`}
        </button>
        <span className={`truncate text-xs ${phase === 'error' ? 'text-red-400' : 'text-zinc-400'}`} title={statusText}>
          {statusText}
        </span>
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        <span className="w-16 shrink-0">{messages.vehicleAudio.volume}</span>
        <input
          type="range"
          min={0}
          max={MAX_VOLUME}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-10 text-right tabular-nums text-zinc-300">{Math.round(volume * 100)} %</span>
      </label>
      <LevelMeter level={level} label={messages.vehicleAudio.level} />
    </div>
  );
}
