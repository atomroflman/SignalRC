'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useControlFlowStore } from './control-flow-store';
import { useCarAudioSettings, usePushToTalkStore } from './audio-store';
import { useI18n } from '@/i18n/provider';

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface AudioChatProps {
  carId?: number;
}

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

/**
 * Push-to-talk to the vehicle speaker. Only the driver (active control session) can talk;
 * listening to the vehicle happens in the video panel (audio track of the stream).
 * Renders nothing if the vehicle has no speaker configured.
 */
export default function AudioChat({ carId }: AudioChatProps) {
  const { messages } = useI18n();
  const { outputDevice } = useCarAudioSettings(carId);
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [talking, setTalkingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTalkingGlobal = usePushToTalkStore((state) => state.setTalking);

  const talkingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  // Chunks are converted asynchronously; chaining keeps them in recording order.
  const sendChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const { connection, carSession } = useControlFlowStore();
  const hasSession = carSession != null && connection != null && carId != null;

  const setTalking = useCallback(
    (value: boolean) => {
      talkingRef.current = value;
      setTalkingState(value);
      setTalkingGlobal(value);
    },
    [setTalkingGlobal],
  );

  const loadMicrophones = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(
        devices
          .filter((device) => device.kind === 'audioinput')
          .map((device) => ({
            deviceId: device.deviceId,
            label: device.label || messages.audioChat.microphoneLabel(device.deviceId),
          })),
      );
    } catch (err) {
      console.error('Error enumerating audio devices:', err);
    }
  }, [messages]);

  const releaseMicrophone = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    recorderRef.current = null;
  }, []);

  const stopTalking = useCallback(() => {
    if (!talkingRef.current) return;
    setTalking(false);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      // onstop sends StopAudioTalk after the last chunk.
      recorder.stop();
    } else {
      releaseMicrophone();
    }
  }, [releaseMicrophone, setTalking]);

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
      setTalking(false);
      setError(messages.audioChat.microphoneDenied(err instanceof Error ? err.message : String(err)));
      return;
    }
    micStreamRef.current = stream;
    // Device labels only become visible after the first permission grant.
    loadMicrophones();

    let accepted = false;
    try {
      accepted = await connection.invoke('StartAudioTalk', carId, carSession, talkFormat.format);
    } catch (err) {
      console.warn('StartAudioTalk failed:', err);
    }
    if (!accepted) {
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
  }, [hasSession, connection, carId, carSession, selectedInput, messages, loadMicrophones, releaseMicrophone, setTalking]);

  useEffect(() => {
    if (hasSession) {
      loadMicrophones();
    }
  }, [hasSession, loadMicrophones]);

  // The vehicle stops playback when the control session changes; mirror that here.
  useEffect(() => {
    return () => stopTalking();
  }, [carSession, carId, stopTalking]);

  if (!outputDevice) {
    return null;
  }

  return (
    <div className="bg-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">{messages.audioChat.title}</h3>
        {hasSession && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${talking ? 'bg-red-500' : error ? 'bg-red-500' : 'bg-zinc-400'}`} />
            <span className="text-xs text-zinc-400">
              {talking ? messages.audioChat.talking : error ? messages.audioChat.error : messages.audioChat.ready}
            </span>
          </div>
        )}
      </div>

      {!hasSession ? (
        <div className="text-xs text-zinc-500 text-center py-4">{messages.audioChat.connectVehicle}</div>
      ) : (
        <>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-xs text-zinc-400 mb-1">{messages.audioChat.microphone}</label>
              <select
                value={selectedInput}
                onChange={(e) => setSelectedInput(e.target.value)}
                className="w-full text-xs p-1.5 bg-zinc-700 border border-zinc-600 rounded text-zinc-200"
                disabled={talking}
              >
                {microphones.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                    {device.deviceId === 'default' ? ` ${messages.audioChat.defaultDeviceSuffix}` : ''}
                  </option>
                ))}
                {microphones.length === 0 && <option value="">{messages.audioChat.noMicrophone}</option>}
              </select>
            </div>
            <button
              onClick={loadMicrophones}
              className="px-3 py-1.5 text-xs bg-zinc-600 hover:bg-zinc-500 text-zinc-200 rounded font-medium transition-colors"
              title={messages.audioChat.refreshDevices}
            >
              ↻
            </button>
          </div>

          <button
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              startTalking();
            }}
            onPointerUp={stopTalking}
            onPointerCancel={stopTalking}
            onContextMenu={(e) => e.preventDefault()}
            className={`w-full px-3 py-2 text-xs rounded font-medium transition-colors select-none touch-none ${
              talking ? 'bg-red-600 text-white animate-pulse' : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            {talking ? messages.audioChat.releaseToStop : messages.audioChat.pushToTalk}
          </button>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </>
      )}
    </div>
  );
}
