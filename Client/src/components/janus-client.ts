import type {
  Janus,
  JanusPluginHandle,
  JanusPluginOptions,
  JanusStatic,
  JanusStreamInfo,
  JanusStreamingMessage,
} from '@/types/janus';

// Shared helpers for the Janus streaming plugin (video streams and vehicle audio).

export const JANUS_SERVERS = ['/janus', '/janus-ws'];
const JANUS_SCRIPT_ID = 'janus-gateway-sdk-script';

export function loadJanusScript(
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

export function initJanus(JanusCtor: JanusStatic): Promise<void> {
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

export async function fetchIceServers(): Promise<RTCIceServer[] | undefined> {
  try {
    const res = await fetch('/api/webrtc/ice-servers');
    if (!res.ok) return undefined;
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    return Array.isArray(data.iceServers) ? data.iceServers : undefined;
  } catch {
    return undefined;
  }
}

export function createJanusSession(
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

export function attachStreamingPlugin(
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

export function listJanusStreams(handle: JanusPluginHandle): Promise<JanusStreamInfo[]> {
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

export function watchStream(handle: JanusPluginHandle, id: number): Promise<void> {
  return new Promise((resolve, reject) => {
    handle.send({
      message: { request: 'watch', id },
      success: () => resolve(),
      error: (err: string) => reject(new Error(err)),
    });
  });
}

export function createAnswerAndStart(
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
