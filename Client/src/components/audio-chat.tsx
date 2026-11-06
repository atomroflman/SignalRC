'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useControlFlowStore } from './control-flow-store';
import { useCarAudioSettings, useCarAudioStatus, usePushToTalkStore, useStoredNumber } from './audio-store';
import { LevelMeter, dbToLevel, useAnalyserLevel } from './level-meter';
import { useI18n } from '@/i18n/provider';

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface AudioChatProps {
  carId?: number;
  /** Inside a titled section (main page accordion): no own heading. */
  embedded?: boolean;
}

// Push-to-talk is recorded in a container the Onboard's ffmpeg can demux from a pipe.
// Chromium records WebM, Firefox records Ogg; both carry Opus.
const TALK_FORMATS: Array<{ mimeType: string; format: string }> = [
  { mimeType: 'audio/webm;codecs=opus', format: 'webm' },
  { mimeType: 'audio/ogg;codecs=opus', format: 'ogg' },
];
// Small chunks: the vehicle can start playing sooner and each late chunk hurts less.
const TALK_TIMESLICE_MS = 60;
const TALK_BITRATE = 32000;
// Select value for the computer's own sound instead of a microphone.
const PC_AUDIO_INPUT = 'pc-audio';
const MIC_GAIN_STORAGE_KEY = 'signalrc.pttMicGain';
const MAX_MIC_GAIN = 3;
const MAX_SPEAKER_VOLUME = 2;
// The speaker slider sends at most this often while dragging; the last value always goes out.
const SPEAKER_VOLUME_SEND_MS = 150;

// The browser microphone runs through Web Audio so its gain can be set and a meter can tap it;
// the recorder records the graph's output. It stays open for the whole control session.
type MicGraph = {
  deviceId: string;
  stream: MediaStream;
  context: AudioContext;
  gain: GainNode;
  analyser: AnalyserNode;
  output: MediaStream;
};

function createMicGraph(stream: MediaStream, gainValue: number, deviceId: string): MicGraph {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const gain = context.createGain();
  gain.gain.value = gainValue;
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const destination = context.createMediaStreamDestination();
  source.connect(gain);
  gain.connect(analyser);
  gain.connect(destination);
  void context.resume();
  return { deviceId, stream, context, gain, analyser, output: destination.stream };
}

function closeMicGraph(graph: MicGraph) {
  graph.stream.getTracks().forEach((track) => track.stop());
  void graph.context.close();
}

function pickTalkFormat() {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return TALK_FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mimeType));
}

// Push-to-talk can also be held on a keyboard key or a gamepad button. Bindings are per browser
// (the gamepad is local hardware), so they live in localStorage.
type PttBinding =
  | { kind: 'key'; code: string }
  | { kind: 'gamepad'; gamepadId: string; button: number };

const PTT_BINDING_STORAGE_KEY = 'signalrc.pushToTalkBinding';
const GAMEPAD_POLL_MS = 30;

function loadBinding(): PttBinding | null {
  try {
    const raw = window.localStorage.getItem(PTT_BINDING_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PttBinding) : null;
  } catch {
    return null;
  }
}

function saveBinding(binding: PttBinding | null) {
  try {
    if (binding) window.localStorage.setItem(PTT_BINDING_STORAGE_KEY, JSON.stringify(binding));
    else window.localStorage.removeItem(PTT_BINDING_STORAGE_KEY);
  } catch {
    // Storage blocked (private mode) — binding just isn't remembered.
  }
}

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
}

function isButtonPressed(button: GamepadButton | undefined) {
  return !!button && (button.pressed || button.value > 0.5);
}

function keyLabel(code: string) {
  return code.replace(/^Key/, '').replace(/^Digit/, '');
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
export default function AudioChat({ carId, embedded }: AudioChatProps) {
  const { messages } = useI18n();
  const { outputDevice, settings } = useCarAudioSettings(carId);
  const status = useCarAudioStatus(carId);
  const [micGain, setMicGain] = useStoredNumber(MIC_GAIN_STORAGE_KEY, 1);
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null);
  const micOpen = micAnalyser != null;
  const micLevel = useAnalyserLevel(micAnalyser);
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [talking, setTalkingState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setTalkingGlobal = usePushToTalkStore((state) => state.setTalking);

  const talkingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const micGraphRef = useRef<MicGraph | null>(null);
  const micGainRef = useRef(micGain);
  micGainRef.current = micGain;
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
    if (micGraphRef.current) closeMicGraph(micGraphRef.current);
    micGraphRef.current = null;
    setMicAnalyser(null);
  }, []);

  useEffect(() => {
    const graph = micGraphRef.current;
    if (graph) graph.gain.gain.setTargetAtTime(micGain, graph.context.currentTime, 0.02);
  }, [micGain]);

  const stopTalking = useCallback(() => {
    if (!talkingRef.current) return;
    setTalking(false);
    const recorder = recorderRef.current;
    // onstop sends StopAudioTalk after the last chunk. The microphone stays open for the next press.
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, [setTalking]);

  /**
   * Captures tab or system sound through screen sharing. Browsers demand a fresh click or key press
   * for the picker, so it opens on selection, not from a held push-to-talk or a gamepad button.
   * Voice processing stays off: it would treat music and game sound as noise.
   */
  const openPcAudio = useCallback(async () => {
    setError(null);
    releaseMicrophone();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
      } as DisplayMediaStreamOptions);
    } catch (err) {
      setError(messages.audioChat.pcAudioDenied(err instanceof Error ? err.message : String(err)));
      return;
    }
    const [track] = stream.getAudioTracks();
    if (!track) {
      stream.getTracks().forEach((t) => t.stop());
      setError(messages.audioChat.pcAudioNoTrack);
      return;
    }
    // Only the sound is used.
    stream.getVideoTracks().forEach((t) => t.stop());
    track.onended = () => {
      if (micGraphRef.current?.stream === stream) releaseMicrophone();
    };
    const graph = createMicGraph(stream, micGainRef.current, PC_AUDIO_INPUT);
    micGraphRef.current = graph;
    setMicAnalyser(graph.analyser);
  }, [messages, releaseMicrophone]);

  const selectInput = useCallback(
    (value: string) => {
      setSelectedInput(value);
      if (micGraphRef.current?.deviceId === PC_AUDIO_INPUT) releaseMicrophone();
      if (value === PC_AUDIO_INPUT) void openPcAudio();
    },
    [openPcAudio, releaseMicrophone],
  );

  /**
   * Opens the microphone on first use and keeps it for the whole control session, so later presses
   * record at once (no permission prompt, no device start-up). Reopens when another microphone is picked.
   */
  const ensureMicrophone = useCallback(async (): Promise<MicGraph> => {
    const current = micGraphRef.current;
    if (current && current.deviceId === selectedInput && current.stream.getAudioTracks().some((t) => t.readyState === 'live')) {
      return current;
    }
    releaseMicrophone();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedInput ? { exact: selectedInput } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const graph = createMicGraph(stream, micGainRef.current, selectedInput);
    micGraphRef.current = graph;
    setMicAnalyser(graph.analyser);
    // Device labels only become visible after the first permission grant.
    loadMicrophones();
    return graph;
  }, [selectedInput, releaseMicrophone, loadMicrophones]);

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

    // PC audio was stopped or refused: this press only reopens the picker, the next one talks.
    if (selectedInput === PC_AUDIO_INPUT) {
      const live = micGraphRef.current?.stream.getAudioTracks().some((t) => t.readyState === 'live');
      if (!live) {
        await openPcAudio();
        return;
      }
    }

    setTalking(true);

    let graph: MicGraph;
    try {
      graph = await ensureMicrophone();
    } catch (err) {
      setTalking(false);
      setError(messages.audioChat.microphoneDenied(err instanceof Error ? err.message : String(err)));
      return;
    }
    if (!talkingRef.current) return; // released while the microphone was opening

    // Record right away and hold the chunks until the vehicle accepted, so the start-up round trip
    // costs no words.
    const burst = { accepted: false, rejected: false, stopped: false, queue: [] as Blob[] };
    const sendChunk = (data: Blob) => {
      sendChainRef.current = sendChainRef.current
        .then(async () => {
          const payload = toBase64(await data.arrayBuffer());
          await connection.send('SendAudioChunk', carId, carSession, payload);
        })
        .catch((err) => console.warn('SendAudioChunk failed:', err));
    };
    const sendStop = () => {
      sendChainRef.current = sendChainRef.current
        .then(() => connection.invoke('StopAudioTalk', carId, carSession))
        .catch((err) => console.warn('StopAudioTalk failed:', err));
    };

    const recorder = new MediaRecorder(graph.output, {
      mimeType: talkFormat.mimeType,
      audioBitsPerSecond: TALK_BITRATE,
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size === 0 || burst.rejected) return;
      if (burst.accepted) sendChunk(event.data);
      else burst.queue.push(event.data);
    };
    recorder.onstop = () => {
      if (recorderRef.current === recorder) recorderRef.current = null;
      burst.stopped = true;
      // Not accepted yet: the accept handler sends the stop once the queue is out.
      if (burst.accepted) sendStop();
    };
    recorderRef.current = recorder;
    recorder.start(TALK_TIMESLICE_MS);

    let accepted = false;
    try {
      accepted = await connection.invoke('StartAudioTalk', carId, carSession, talkFormat.format);
    } catch (err) {
      console.warn('StartAudioTalk failed:', err);
    }
    if (!accepted) {
      burst.rejected = true;
      burst.queue = [];
      if (recorder.state !== 'inactive') recorder.stop();
      setTalking(false);
      setError(messages.audioChat.talkRejected);
      return;
    }
    burst.accepted = true;
    burst.queue.forEach(sendChunk);
    burst.queue = [];
    if (burst.stopped) sendStop(); // released before the vehicle answered
  }, [hasSession, connection, carId, carSession, messages, ensureMicrophone, setTalking, selectedInput, openPcAudio]);

  useEffect(() => {
    if (hasSession) {
      loadMicrophones();
    }
  }, [hasSession, loadMicrophones]);

  // -- speaker volume (driver, live on the vehicle) ---------------------------------------

  // Local value while this browser changes it; otherwise the car's stored volume.
  const [speakerVolume, setSpeakerVolume] = useState<number | undefined>(undefined);
  const shownSpeakerVolume = speakerVolume ?? settings?.outputVolume ?? 1;
  const pendingVolumeRef = useRef<number | null>(null);
  const volumeTimerRef = useRef<number | null>(null);
  const volumeTargetRef = useRef({ connection, carId });
  volumeTargetRef.current = { connection, carId };

  useEffect(() => setSpeakerVolume(undefined), [carId]);

  const flushSpeakerVolume = useCallback(() => {
    volumeTimerRef.current = null;
    const next = pendingVolumeRef.current;
    const { connection: conn, carId: id } = volumeTargetRef.current;
    if (next == null || !conn || id == null) return;
    pendingVolumeRef.current = null;
    conn.invoke('SetSpeakerVolume', id, next).catch((err: unknown) => console.warn('SetSpeakerVolume failed:', err));
    volumeTimerRef.current = window.setTimeout(() => flushSpeakerVolumeRef.current(), SPEAKER_VOLUME_SEND_MS);
  }, []);
  const flushSpeakerVolumeRef = useRef(flushSpeakerVolume);
  flushSpeakerVolumeRef.current = flushSpeakerVolume;

  const changeSpeakerVolume = useCallback(
    (value: number) => {
      setSpeakerVolume(value);
      pendingVolumeRef.current = value;
      if (volumeTimerRef.current == null) flushSpeakerVolume();
    },
    [flushSpeakerVolume],
  );

  useEffect(
    () => () => {
      if (volumeTimerRef.current != null) window.clearTimeout(volumeTimerRef.current);
    },
    [],
  );

  // -- key / gamepad binding -------------------------------------------------------------

  const [binding, setBinding] = useState<PttBinding | null>(null);
  const [learning, setLearning] = useState(false);
  // Handlers read the latest callbacks without re-subscribing on every render.
  const startRef = useRef(startTalking);
  const stopRef = useRef(stopTalking);
  startRef.current = startTalking;
  stopRef.current = stopTalking;

  useEffect(() => {
    setBinding(loadBinding());
  }, []);

  const assignBinding = useCallback((next: PttBinding | null) => {
    setBinding(next);
    saveBinding(next);
    setLearning(false);
  }, []);

  // Learn mode: the next key press or newly pressed gamepad button becomes the binding.
  useEffect(() => {
    if (!learning) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') setLearning(false);
      else assignBinding({ kind: 'key', code: e.code });
    };
    const initiallyPressed = new Set<string>();
    for (const gp of navigator.getGamepads?.() ?? []) {
      gp?.buttons.forEach((b, i) => isButtonPressed(b) && initiallyPressed.add(`${gp.id}#${i}`));
    }
    const timer = window.setInterval(() => {
      for (const gp of navigator.getGamepads?.() ?? []) {
        if (!gp) continue;
        const index = gp.buttons.findIndex((b, i) => isButtonPressed(b) && !initiallyPressed.has(`${gp.id}#${i}`));
        if (index >= 0) {
          assignBinding({ kind: 'gamepad', gamepadId: gp.id, button: index });
          return;
        }
      }
    }, GAMEPAD_POLL_MS);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [learning, assignBinding]);

  // Active binding: hold to talk.
  useEffect(() => {
    if (!binding || learning || !hasSession || !outputDevice) return;

    if (binding.kind === 'key') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== binding.code || e.repeat || isEditableTarget(e.target)) return;
        e.preventDefault();
        startRef.current();
      };
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code !== binding.code) return;
        stopRef.current();
      };
      // Releasing the key while the window is unfocused never fires keyup.
      const onBlur = () => stopRef.current();
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onBlur);
        stopRef.current();
      };
    }

    let wasPressed = false;
    const timer = window.setInterval(() => {
      const gp = (navigator.getGamepads?.() ?? []).find((g) => g?.id === binding.gamepadId);
      const pressed = isButtonPressed(gp?.buttons[binding.button]);
      if (pressed && !wasPressed) startRef.current();
      if (!pressed && wasPressed) stopRef.current();
      wasPressed = pressed;
    }, GAMEPAD_POLL_MS);
    return () => {
      window.clearInterval(timer);
      if (wasPressed) stopRef.current();
    };
  }, [binding, learning, hasSession, outputDevice]);

  const bindingText = !binding
    ? messages.audioChat.bindingNone
    : binding.kind === 'key'
      ? messages.audioChat.bindingKey(keyLabel(binding.code))
      : messages.audioChat.bindingGamepad(binding.button, binding.gamepadId);

  // The vehicle stops playback when the control session changes; mirror that here and give the
  // microphone back (it was only held open for this session).
  useEffect(() => {
    return () => {
      stopTalking();
      releaseMicrophone();
    };
  }, [carSession, carId, stopTalking, releaseMicrophone]);

  if (!outputDevice) {
    return null;
  }

  return (
    <div className="bg-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        {!embedded && <h3 className="text-sm font-medium text-zinc-200">{messages.audioChat.title}</h3>}
        {hasSession && (
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${talking || error ? 'bg-red-500' : micOpen ? 'bg-green-500' : 'bg-zinc-400'}`} />
            <span className="text-xs text-zinc-400">
              {talking ? messages.audioChat.talking : error ? messages.audioChat.error : micOpen ? messages.audioChat.micReady : messages.audioChat.ready}
            </span>
            {micOpen && !talking && (
              <button
                onClick={releaseMicrophone}
                className="px-1.5 py-0.5 text-[10px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                title={messages.audioChat.releaseMicHint}
              >
                {messages.audioChat.releaseMic}
              </button>
            )}
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
                onChange={(e) => selectInput(e.target.value)}
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
                {typeof navigator.mediaDevices?.getDisplayMedia === 'function' && (
                  <option value={PC_AUDIO_INPUT}>{messages.audioChat.pcAudio}</option>
                )}
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

          <div className="flex items-center gap-2 text-xs">
            <span className="text-zinc-400">{messages.audioChat.bindingLabel}</span>
            <span className={`flex-1 truncate ${learning ? 'text-amber-300' : 'text-zinc-200'}`} title={bindingText}>
              {learning ? messages.audioChat.bindingWaiting : bindingText}
            </span>
            <button
              onClick={() => setLearning((l) => !l)}
              className="px-2 py-1 bg-zinc-600 hover:bg-zinc-500 text-zinc-200 rounded"
            >
              {learning ? messages.audioChat.bindingCancel : messages.audioChat.bindingAssign}
            </button>
            {binding && !learning && (
              <button
                onClick={() => assignBinding(null)}
                className="px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                title={messages.audioChat.bindingClear}
              >
                ✕
              </button>
            )}
          </div>
          {binding?.kind === 'gamepad' && (
            <div className="text-[10px] text-zinc-500">{messages.audioChat.bindingGamepadHint}</div>
          )}

          <div className="space-y-1.5 border-t border-zinc-700 pt-2">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="w-16 shrink-0">{messages.audioChat.micGain}</span>
              <input
                type="range"
                min={0}
                max={MAX_MIC_GAIN}
                step={0.05}
                value={micGain}
                onChange={(e) => setMicGain(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-10 text-right tabular-nums text-zinc-300">{Math.round(micGain * 100)} %</span>
            </label>
            <LevelMeter level={micLevel} label={messages.audioChat.micLevel} />
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="w-16 shrink-0">{messages.audioChat.speakerVolume}</span>
              <input
                type="range"
                min={0}
                max={MAX_SPEAKER_VOLUME}
                step={0.05}
                value={shownSpeakerVolume}
                onChange={(e) => changeSpeakerVolume(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-10 text-right tabular-nums text-zinc-300">{Math.round(shownSpeakerVolume * 100)} %</span>
            </label>
            <LevelMeter level={dbToLevel(status?.outputLevelDb)} label={messages.audioChat.speakerLevel} />
            {status?.sounds && status.sounds.length > 0 && (
              <div className="truncate text-[10px] text-sky-300">♪ {messages.audioChat.playingSounds(status.sounds.join(', '))}</div>
            )}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}
        </>
      )}
    </div>
  );
}
