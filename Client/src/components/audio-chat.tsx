'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useControlFlowStore } from './control-flow-store';
import { useI18n } from '@/i18n/provider';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
  isDefault: boolean;
}

interface AudioChatProps {
  carId?: number;
}

export default function AudioChat({ carId }: AudioChatProps) {
  const { messages } = useI18n();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<string>('');
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [volume, setVolume] = useState(100);
  const [connectionState, setConnectionState] = useState<string>('disconnected');
  
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  
  const flowControl = useControlFlowStore();
  const isConnected = flowControl.carSession != null;

  const loadAudioDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices: AudioDevice[] = [];
      const audioOutputDevices: AudioDevice[] = [];
      
      let defaultInput: string | null = null;
      let defaultOutput: string | null = null;
      
      for (const device of devices) {
        if (device.kind === 'audioinput') {
          const isDefault = device.deviceId === defaultInput;
          audioInputDevices.push({
            deviceId: device.deviceId,
            label: device.label || messages.audioChat.microphoneLabel(device.deviceId),
            kind: 'audioinput',
            isDefault
          });
        } else if (device.kind === 'audiooutput') {
          const isDefault = device.deviceId === defaultOutput;
          audioOutputDevices.push({
            deviceId: device.deviceId,
            label: device.label || messages.audioChat.speakerLabel(device.deviceId),
            kind: 'audiooutput',
            isDefault
          });
        }
      }
      
      const allDevices = [...audioInputDevices, ...audioOutputDevices];
      setAudioDevices(allDevices);
      
      if (!selectedInput && audioInputDevices.length > 0) {
        setSelectedInput(audioInputDevices.find(d => d.isDefault)?.deviceId || audioInputDevices[0].deviceId);
      }
      if (!selectedOutput && audioOutputDevices.length > 0) {
        setSelectedOutput(audioOutputDevices.find(d => d.isDefault)?.deviceId || audioOutputDevices[0].deviceId);
      }
    } catch (err) {
      console.error('Error enumerating audio devices:', err);
    }
  }, [selectedInput, selectedOutput, messages]);

  useEffect(() => {
    if (isConnected) {
      loadAudioDevices();
      setConnectionState('connected');
    } else {
      setConnectionState('disconnected');
      stopAudio();
    }
    
    return () => {
      stopAudio();
    };
  }, [isConnected, carId, loadAudioDevices]);

  const startLocalAudio = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: selectedInput ? { exact: selectedInput } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setConnectionState('error');
      return null;
    }
  };

  const stopLocalAudio = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }
  };

  const stopAudio = () => {
    stopLocalAudio();
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
  };

  const toggleAudio = async () => {
    if (isEnabled) {
      stopLocalAudio();
      setIsEnabled(false);
      setConnectionState('connected');
    } else {
      const stream = await startLocalAudio();
      if (stream) {
        setIsEnabled(true);
        setConnectionState('active');
      }
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      if (localStreamRef.current) {
        const track = localStreamRef.current.getAudioTracks()[0];
        if (track) {
          track.enabled = false;
        }
      }
      setIsRecording(false);
    } else {
      if (localStreamRef.current) {
        const track = localStreamRef.current.getAudioTracks()[0];
        if (track) {
          track.enabled = true;
          setIsRecording(true);
        }
      } else {
        const stream = await startLocalAudio();
        if (stream) {
          setIsEnabled(true);
          const track = stream.getAudioTracks()[0];
          if (track) {
            setIsRecording(true);
          }
        }
      }
    }
  };

  const handleInputChange = async (deviceId: string) => {
    setSelectedInput(deviceId);
    if (isEnabled && localStreamRef.current) {
      stopLocalAudio();
      const stream = await startLocalAudio();
      if (stream) {
        setIsEnabled(true);
      }
    }
  };

  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    if (localAudioRef.current) {
      localAudioRef.current.volume = newVolume / 100;
    }
  };

  const inputDevices = audioDevices.filter(d => d.kind === 'audioinput');
  const outputDevices = audioDevices.filter(d => d.kind === 'audiooutput');

  const getStatusColor = () => {
    switch (connectionState) {
      case 'active': return 'bg-green-500';
      case 'connected': return 'bg-blue-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'active': return isRecording ? messages.audioChat.recording : messages.audioChat.active;
      case 'connected': return messages.audioChat.ready;
      case 'error': return messages.audioChat.error;
      default: return messages.audioChat.disconnected;
    }
  };

  return (
    <div className="bg-zinc-800 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-zinc-200">{messages.audioChat.title}</h3>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
          <span className="text-xs text-zinc-400">{getStatusText()}</span>
        </div>
      </div>

      {!isConnected ? (
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
                onChange={(e) => handleInputChange(e.target.value)}
                className="w-full text-xs p-1.5 bg-zinc-700 border border-zinc-600 rounded text-zinc-200"
                disabled={isEnabled}
              >
                {inputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label} {device.isDefault ? messages.audioChat.defaultDeviceSuffix : ''}
                  </option>
                ))}
                {inputDevices.length === 0 && (
                  <option value="">{messages.audioChat.noMicrophone}</option>
                )}
              </select>
            </div>
            
            <div>
              <label className="block text-xs text-zinc-400 mb-1">{messages.audioChat.speaker}</label>
              <select
                value={selectedOutput}
                onChange={(e) => setSelectedOutput(e.target.value)}
                className="w-full text-xs p-1.5 bg-zinc-700 border border-zinc-600 rounded text-zinc-200"
              >
                {outputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label} {device.isDefault ? messages.audioChat.defaultDeviceSuffix : ''}
                  </option>
                ))}
                {outputDevices.length === 0 && (
                  <option value="">{messages.audioChat.noSpeaker}</option>
                )}
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
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="flex-1 h-1 bg-zinc-600 rounded-lg appearance-none cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-8">{volume}%</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={toggleAudio}
              className={`flex-1 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                isEnabled
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              {isEnabled ? messages.audioChat.mute : messages.audioChat.unmute}
            </button>
            
            <button
              onClick={toggleRecording}
              className={`flex-1 px-3 py-1.5 text-xs rounded font-medium transition-colors ${
                isRecording
                  ? 'bg-red-600 hover:bg-red-700 text-white animate-pulse'
                  : 'bg-zinc-600 hover:bg-zinc-500 text-zinc-200'
              }`}
              disabled={!isEnabled}
            >
              {isRecording ? messages.audioChat.stop : messages.audioChat.record}
            </button>
            
            <button
              onClick={loadAudioDevices}
              className="px-3 py-1.5 text-xs bg-zinc-600 hover:bg-zinc-500 text-zinc-200 rounded font-medium transition-colors"
              title={messages.audioChat.refreshDevices}
            >
              ↻
            </button>
          </div>
        </>
      )}

      <audio ref={localAudioRef} autoPlay playsInline muted={!isEnabled} className="hidden" />
    </div>
  );
}
