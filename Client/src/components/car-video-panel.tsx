'use client';

import { JSX, useEffect, useMemo, useState } from 'react';
import VideoStream from './video-stream';
import type { VideoStreamInfo } from '@/types/video-stream';
import { useCarUiStore } from './car-ui-store';
import { useI18n } from '@/i18n/provider';

const STREAM_REFRESH_EVENT = 'videoStreams:refresh';

type CarVideoPanelProps = {
  carId?: number;
};

function getStoredStreamId(carId: number): number | undefined {
  const rawValue = window.localStorage.getItem(`lastSelectedStreamId:${carId}`);
  if (!rawValue) {
    return undefined;
  }

  const parsed = Number(rawValue);
  return Number.isInteger(parsed) ? parsed : undefined;
}

// ponytail: server returns streams already ordered by Priority then Name; client
// used to re-sort on a field that no longer exists on VideoStreamMapItem.
function sortStreams(streams: VideoStreamInfo[]): VideoStreamInfo[] {
  return streams;
}

export default function CarVideoPanel({ carId }: CarVideoPanelProps): JSX.Element {
  const { messages } = useI18n();
  const [videoConnection, setVideoConnection] = useState<any>(undefined);
  const [streams, setStreams] = useState<VideoStreamInfo[]>([]);
  const [selectedStreamId, setSelectedStreamId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reconnectVersion, setReconnectVersion] = useState(0);
  const connectCarUi = useCarUiStore(state => state.connect);

  useEffect(() => {
    void connectCarUi();
  }, [connectCarUi]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const updateVisibility = () => setDocumentVisible(!document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);

    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    let mounted = true;
    let conn: any;

    (async () => {
      try {
        const signalR = await import('@microsoft/signalr');
        conn = new signalR.HubConnectionBuilder()
          .withUrl('/hubs/connection')
          .withAutomaticReconnect()
          .build();

        conn.onreconnected(() => {
          setReconnectVersion(currentVersion => currentVersion + 1);
          window.dispatchEvent(new Event(STREAM_REFRESH_EVENT));
        });

        await conn.start();
        if (!mounted) {
          try {
            await conn.stop();
          } catch {}
          return;
        }

        setVideoConnection(conn);
      } catch (connectionError) {
        console.debug('Failed to start video hub connection:', connectionError);
        if (mounted) {
          setError(messages.carVideoPanel.hubConnectionFailed);
        }
      }
    })();

    return () => {
      mounted = false;
      if (conn) {
        try {
          conn.stop();
        } catch {}
      }
      setVideoConnection(undefined);
    };
  }, [messages]);

  useEffect(() => {
    if (!carId || !videoConnection) {
      setStreams([]);
      setSelectedStreamId(undefined);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const loadStreams = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await videoConnection.invoke('GetVideoStreamsForCar', carId) as VideoStreamInfo[];
        if (cancelled) {
          return;
        }

        setStreams(sortStreams(result ?? []));
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        console.error('Failed to load video streams:', loadError);
        setError(messages.carVideoPanel.loadStreamsFailed);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const handleRefresh = () => {
      void loadStreams();
    };

    void loadStreams();
    window.addEventListener(STREAM_REFRESH_EVENT, handleRefresh);

    return () => {
      cancelled = true;
      window.removeEventListener(STREAM_REFRESH_EVENT, handleRefresh);
    };
  }, [carId, reconnectVersion, videoConnection, messages]);

  useEffect(() => {
    if (!carId) {
      setSelectedStreamId(undefined);
      return;
    }

    if (streams.length === 0) {
      setSelectedStreamId(undefined);
      return;
    }

    setSelectedStreamId(currentValue => {
      const hasCurrentSelection = currentValue !== undefined && streams.some(stream => stream.serverId === currentValue);
      if (hasCurrentSelection) {
        return currentValue;
      }

      const storedStreamId = getStoredStreamId(carId);
      if (storedStreamId !== undefined && streams.some(stream => stream.serverId === storedStreamId)) {
        return storedStreamId;
      }

      return streams.find(stream => stream.enabled)?.serverId ?? streams[0]?.serverId;
    });
  }, [carId, streams]);

  useEffect(() => {
    if (!carId || selectedStreamId === undefined) {
      return;
    }

    window.localStorage.setItem(`lastSelectedStreamId:${carId}`, String(selectedStreamId));
  }, [carId, selectedStreamId]);

  const selectedStream = useMemo(
    () => streams.find(stream => stream.serverId === selectedStreamId),
    [selectedStreamId, streams],
  );

  // NOTE: Streams are no longer activated/deactivated automatically when the
  // panel mounts or the selection changes. Use the Video Settings panel to
  // start/stop a stream manually.

  if (!carId) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-900 p-10 text-center text-sm text-zinc-300">
        {messages.carVideoPanel.selectVehicleFirst}
      </div>
    );
  }

  if (loading && streams.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 text-sm text-zinc-300">
        {messages.carVideoPanel.loadingStreams}
      </div>
    );
  }

  if (error && streams.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-red-900 bg-red-950/70 p-6 text-center text-sm text-red-200">
        {error}
      </div>
    );
  }

  if (streams.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-center text-sm text-zinc-300">
        {messages.carVideoPanel.noStreamsConfigured}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap gap-2">
        {streams.map(stream => {
          const isSelected = stream.serverId === selectedStreamId;
          const buttonClasses = isSelected
            ? 'border-zinc-900 bg-zinc-900 text-white'
            : 'border-zinc-300 bg-white text-zinc-700 hover:border-zinc-500';

          return (
            <button
              key={stream.serverId}
              type="button"
              className={`rounded-full border px-3 py-2 text-sm transition-colors ${buttonClasses}`}
              onClick={() => setSelectedStreamId(stream.serverId)}
            >
              <span className="font-medium">{stream.name}</span>
              <span className="ml-2 text-xs opacity-80">
                {stream.location ? `${stream.location} · ` : ''}
                {stream.enabled ? messages.carVideoPanel.streamEnabled : messages.carVideoPanel.streamDisabled}
                {stream.viewerCount > 0 ? ` · ${messages.carVideoPanel.viewerCount(stream.viewerCount)}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {!selectedStream && (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-sm text-zinc-300">
          {messages.carVideoPanel.noStreamSelected}
        </div>
      )}

      {selectedStream && !selectedStream.enabled && (
        <div className="rounded-2xl border border-amber-900 bg-amber-950/50 p-6 text-sm text-amber-200">
          {messages.carVideoPanel.streamDisabledHint}
        </div>
      )}

      {selectedStream && selectedStream.enabled && !documentVisible && (
        <div className="rounded-2xl border border-zinc-700 bg-zinc-900 p-6 text-sm text-zinc-300">
          {messages.carVideoPanel.tabInactiveHint}
        </div>
      )}

      {selectedStream && selectedStream.enabled && documentVisible && (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-black shadow-sm">
          <VideoStream key={selectedStream.serverId} streamId={selectedStream.serverId} streamName={selectedStream.name} />
        </div>
      )}
    </div>
  );
}