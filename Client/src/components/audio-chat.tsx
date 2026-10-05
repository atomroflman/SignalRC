'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Janus, JanusPluginHandle } from '@/types/janus';
import { useControlFlowStore } from './control-flow-store';
import { useI18n } from '@/i18n/provider';
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

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

interface AudioChatProps {
  carId?: number;
}

type ListenState = 'idle' | 'connecting' | 'live' | 'error';

// Push-to-talk is recorded in a container the Onboard's ffmpeg can demux from a pipe.
// Chromium records WebM, Firefox records Ogg; both carry Opus.
const TALK_FORMATS: Array<{ mimeType: string; format: string }> = [
  { mimeType: 'audio/webm;codecs=opus', format: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', format: 'ogg' },
];
const TALK_TIMESLICE_MS = 100;
const TALK_BITRATE = 32000;

function pickTalkFormat() {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return TALK_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mimeType));
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export default function AudioChat({ carId }: AudioChatProps) {
  const { messages } = useI18n();
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [volume, setVolume] = useState(100);
  const [listenState, setListenState] = useState<ListenState>('idle');
  const [talking, setTalking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const janusRef = useRef<Janus | null>(null);
  const handleRef = useRef<JanusPluginHandle | null>(null);
  const listeningRef = useRef(false);
  const talkingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Chunks are converted asynchronously; chaining keeps them in recording order.
  const sendChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const { connection, carSession } = useControlFlowStore();
  const hasSession = carSession != null && connection != null && carId != null;

  const loadAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const result: AudioDevice[] = [];
      for (const device of devices) {
        if (device.kind === 'audioinput') {
          result.push({
            deviceId: device.deviceId,
            label: device.label || messages.audioChat.microphoneLabel(device.deviceId),
            kind: 'audioinput',
          });
        } else if (device.kind === 'audiooutput') {
          result.push({
            deviceId: device.deviceId,
            label: device.label || messages.audioChat.speakerLabel(device.deviceId),
            kind: 'audiooutput',
          });
        }
      }
      setAudioDevices(result);
    } catch (err) {
      console.error('Error enumerating audio devices:', err);
    }
  }, [messages]);

  // -- Listen: vehicle microphone via Janus --------------------------------------------

  const teardownJanus = useCallback(() => {
    if (handleRef.current) {
      try {
        handleRef.current.detach();
      } catch (err) {
        console.warn('Janus detach error:', err);
      }
      handleRef.current = null;
    }
    if (janusRef.current) {
      try {
        janusRef.current.destroy({ cleanupHandles: true });
      } catch (err) {
        console.warn('Janus destroy error:', err);
      }
      janusRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const stopListening = useCallback(async () => {
    const wasListening = listeningRef.current;
    listeningRef.current = false;
    teardownJanus();
    setListenState('idle');
    if (wasListening && connection && carId != null) {
      try {
        await connection.invoke('StopAudioListen', carId);
      } catch (err) {
        console.warn('StopAudioListen failed:', err);
      }
    }
  }, [connection, carId, teardownJanus]);

  const startListening = useCallback(async () => {
    if (!hasSession || listeningRef.current) return;
    listeningRef.current = true;
    setError(null);
    setListenState('connecting');
    try {
      const mountpointId: number | null = await connection.invoke('StartAudioListen', carId, carSession);
      if (mountpointId == null) {
        throw new Error(messages.audioChat.listenRejected);
      }

      const JanusCtor = await loadJanusScript(
        messages.videoStream.browserRequired,
        messages.videoStream.janusUnavailable,
        messages.videoStream.janusScriptFailed,
      );
      await initJanus(JanusCtor);
      const janus = await createJanusSession(JanusCtor, JANUS_SERVERS, await fetchIceServers());
      if (!listeningRef.current) {
        janus.destroy({ cleanupHandles: true });
        return;
      }
      janusRef.current = janus;

      const handle = await attachStreamingPlugin(janus, {
        onmessage: (msg, jsep) => {
          if (msg.error) {
            setError(msg.error);
            setListenState('error');
            return;
          }
          if (jsep && handleRef.current) {
            createAnswerAndStart(handleRef.current, jsep).catch((err: Error) => {
              setError(messages.videoStream.webRtcError(err.message));
              setListenState('error');
            });
          }
        },
        onremotetrack: (track, _mid, on) => {
          if (track.kind !== 'audio' || !remoteAudioRef.current) return;
          remoteAudioRef.current.srcObject = on ? new MediaStream([track]) : null;
          if (on) setListenState('live');
        },
      });
      handleRef.current = handle;
      await watchStream(handle, mountpointId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await stopListening();
      setListenState('error');
    }
  }, [hasSession, connection, carId, carSession, messages, stopListening]);

  // -- Talk: push-to-talk to the vehicle speaker ----------------------------------------

  const releaseMicrophone = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    recorderRef.current = null;
  }, []);

  const stopTalking = useCallback(() => {
    if (!talkingRef.current) return;
    talkingRef.current = false;
    setTalking(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // onstop sends StopAudioTalk after the last chunk.
      recorder.stop();
    } else {
      releaseMicrophone();
    }
  }, [releaseMicrophone]);

  const startTalking = useCallback(async () => {
    if (!hasSession || talkingRef.current) return;
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(messages.audioChat.insecureContext);
      return;
    }
    const talkFormat = pickTalkFormat();
    if (!talkFormat) {
      setError(messages.audioChat.recordingUnsupported);
      return;
    }

    talkingRef.current = true;
    setTalking(true);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedInput ? { exact: selectedInput } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (err) {
      talkingRef.current = false;
      setTalking(false);
      setError(messages.audioChat.microphoneDenied(err instanceof Error ? err.message : String(err)));
      return;
    }
    micStreamRef.current = stream;
    // Device labels only become visible after the first permission grant.
    loadAudioDevices();

    let accepted = false;
    try {
      accepted = await connection.invoke('StartAudioTalk', carId, carSession, talkFormat.format);
    } catch (err) {
      console.warn('StartAudioTalk failed:', err);
    }
    if (!accepted) {
      talkingRef.current = false;
      setTalking(false);
      releaseMicrophone();
      setError(messages.audioChat.talkRejected);
      return;
    }
    if (!talkingRef.current) {
      // Button was released while we were still negotiating.
      releaseMicrophone();
      connection.invoke('StopAudioTalk', carId, carSession).catch(() => {});
      return;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: talkFormat.mimeType,
      audioBitsPerSecond: TALK_BITRATE,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0) return;
      const data = event.data;
      sendChainRef.current = sendChainRef.current
        .then(async () => {
          const payload = toBase64(await data.arrayBuffer());
          await connection.send('SendAudioChunk', carId, carSession, payload);
        })
        .catch((err) => console.warn('SendAudioChunk failed:', err));
    };
    recorder.onstop = () => {
      releaseMicrophone();
      sendChainRef.current = sendChainRef.current
        .then(() => connection.invoke('StopAudioTalk', carId, carSession))
        .catch((err) => console.warn('StopAudioTalk failed:', err));
    };
    recorderRef.current = recorder;
    recorder.start(TALK_TIMESLICE_MS);
  }, [
    hasSession,
    connection,
    carId,
    carSession,
    selectedInput,
    messages,
    loadAudioDevices,
    releaseMicrophone,
  ]);

  // -- lifecycle ------------------------------------------------------------------------

  useEffect(() => {
    if (hasSession) {
      loadAudioDevices();
    }
  }, [hasSession, loadAudioDevices]);

  // The vehicle tears down audio when the control session changes; mirror that here.
  useEffect(() => {
    return () => {
      stopTalking();
      stopListening();
    };
  }, [carSession, carId, stopTalking, stopListening]);

  useEffect(() => {
    if (remoteAudioRef.current) {
      remoteAudioRef.current.volume = volume / 100;
    }
  }, [volume]);

  useEffect(() => {
    const el = remoteAudioRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (el?.setSinkId && selectedOutput) {
      el.setSinkId(selectedOutput).catch((err) => console.warn('setSinkId failed:', err));
    }
  }, [selectedOutput]);

  const inputDevices = audioDevices.filter((d) => d.kind === 'audioinput');
  const outputDevices = audioDevices.filter((d) => d.kind === 'audiooutput');
  const listening = listenState === 'connecting' || listenState === 'live';

  const statusColor = talking
    ? 'bg-red-500'
    : listenState === 'live'
      ? 'bg-green-500'
      : listenState === 'connecting'
        ? 'bg-blue-500'
        : listenState === 'error' || error
          ? 'bg-red-500'
          : hasSession
            ? 'bg-zinc-400'
            : 'bg-gray-500';

  const statusText = talking
    ? messages.audioChat.talking
    : listenState === 'live'
      ? messages.audioChat.listening
      : listenState === 'connecting'
        ? messages.audioChat.connecting
        : listenState === 'error'
          ? messages.audioChat.error
          : messages.audioChat.ready;

  return (
    <div className="bg-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">{messages.audioChat.title}</h3>
        {hasSession && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${statusColor}`} />
            <span className="text-xs text-zinc-400">{statusText}</span>
          </div>
        )}
      </div>

      {!hasSession ? (
        <div className="text-xs text-zinc-500 text-center py-4">
          {messages.audioChat.connectVehicle}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{messages.audioChat.microphone}</label>
              <select
                value={selectedInput}
                onChange={(e) => setSelectedInput(e.target.value)}
                className="w-full text-xs p-1.5 bg-zinc-700 border border-zinc-600 rounded text-zinc-200"
                disabled={talking}
              >
                {inputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                    {device.deviceId === 'default' ? ` ${messages.audioChat.defaultDeviceSuffix}` : ''}
                  </option>
                ))}
                {inputDevices.length === 0 && <option value="">{messages.audioChat.noMicrophone}</option>}
              </select>
            </div>

            <div>
              <label className="block text-xs text-zinc-400 mb-1">{messages.audioChat.speaker}</label>
              <select
                value={selectedOutput}
                onChange={(e) => setSelectedOutput(e.target.value)}
                className="w-full text-xs p-1.5 bg-zinc-700 border border-zinc-600 rounded text-zinc-200"
              >
                {outputDevices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                    {device.deviceId === 'default' ? ` ${messages.audioChat.defaultDeviceSuffix}` : ''}
                  </option>
                ))}
                {outputDevices.length === 0 && <option value="">{messages.audioChat.noSpeaker}</option>}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-400">{messages.audioChat.volume}</label>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1 h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-8">{volume}%</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => (listening ? stopListening() : startListening())}
              className={`flex-1 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                listening ? 'bg-green-700 hover:bg-green-800 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {listening ? messages.audioChat.stopListening : messages.audioChat.listen}
            </button>

            <button
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                startTalking();
              }}
              onPointerUp={stopTalking}
              onPointerCancel={stopTalking}
              onContextMenu={(e) => e.preventDefault()}
              className={`flex-1 px-3 py-1.5 text-xs rounded font-medium transition-colors select-none touch-none ${
                talking ? 'bg-red-600 text-white animate-pulse' : 'bg-zinc-600 hover:bg-zinc-500 text-zinc-200'
              }`}
            >
              {talking ? messages.audioChat.releaseToStop : messages.audioChat.pushToTalk}
            </button>

            <button
              onClick={loadAudioDevices}
              className="px-3 py-1.5 text-xs bg-zinc-600 hover:bg-zinc-500 text-zinc-200 rounded font-medium transition-colors"
              title={messages.audioChat.refreshDevices}
            >
              ↻
            </button>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </>
      )}

      {/* Muted while talking: half-duplex, so the driver doesn't hear their own voice
          coming back from the vehicle speaker through the vehicle microphone. */}
      <audio ref={remoteAudioRef} autoPlay playsInline muted={talking} className="hidden" />
    </div>
  );
}
