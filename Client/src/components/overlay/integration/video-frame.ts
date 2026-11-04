// AP13 – where the video frame actually is (Overlay-Feature.md „Arbeitsfläche
// und Video-Geometrie“): the HUD covers the displayed frame of an
// `object-fit: contain` video, never the letterbox bars of the player.

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

const usable = (v: number) => Number.isFinite(v) && v > 0;

/** The frame of a `contain`-fitted medium inside its element box (relative to the box). */
export function containedFrame(box: Size, media: Size): Rect | null {
  if (!usable(box.width) || !usable(box.height) || !usable(media.width) || !usable(media.height)) return null;
  const scale = Math.min(box.width / media.width, box.height / media.height);
  const width = media.width * scale;
  const height = media.height * scale;
  return { left: (box.width - width) / 2, top: (box.height - height) / 2, width, height };
}

/**
 * The displayed frame relative to a positioned container. `video` is the
 * video element's border box and `container` the container's, both in the
 * same coordinates (e.g. getBoundingClientRect); `media` the received frame
 * size (videoWidth × videoHeight), not the configured camera resolution.
 * Null while nothing is displayed (no metadata, zero size).
 */
export function frameInContainer(container: Rect, video: Rect, media: Size): Rect | null {
  const frame = containedFrame(video, media);
  if (!frame) return null;
  return {
    left: video.left - container.left + frame.left,
    top: video.top - container.top + frame.top,
    width: frame.width,
    height: frame.height,
  };
}

/** Whether two frames differ by more than a sub-pixel (avoids resize feedback loops). */
export function sameFrame(a: Rect | null, b: Rect | null, epsilon = 0.5): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < epsilon && Math.abs(a.top - b.top) < epsilon
    && Math.abs(a.width - b.width) < epsilon && Math.abs(a.height - b.height) < epsilon;
}

/** What a frame layer needs from the player: container size, received size and displayed frame. */
export interface VideoGeometry {
  /** Container size (fallback placement without a frame). */
  box: Size;
  /** Received frame size (videoWidth × videoHeight); 0 × 0 before metadata. */
  media: Size;
  /** Displayed frame relative to the container; null while nothing is displayed. */
  frame: Rect | null;
}

export const NO_GEOMETRY: VideoGeometry = { box: { width: 0, height: 0 }, media: { width: 0, height: 0 }, frame: null };

export function sameGeometry(a: VideoGeometry, b: VideoGeometry): boolean {
  return sameFrame(a.frame, b.frame) && a.media.width === b.media.width && a.media.height === b.media.height
    && Math.abs(a.box.width - b.box.width) < 0.5 && Math.abs(a.box.height - b.box.height) < 0.5;
}

type Listenable = { addEventListener(type: string, l: () => void): void; removeEventListener(type: string, l: () => void): void };
type Boxed = { getBoundingClientRect(): Rect };
export type VideoLike = Boxed & Listenable & { videoWidth: number; videoHeight: number };

export interface FrameObserverEnv {
  ResizeObserver?: new (cb: () => void) => { observe(target: never): void; disconnect(): void };
  window?: Listenable;
  document?: Listenable;
}

/** Video events that change the received size or drop the picture (new stream, camera switch, reset). */
const VIDEO_EVENTS = ["loadedmetadata", "resize", "emptied"] as const;

/**
 * Tracks the displayed frame of `video` inside `container` on every size
 * change (element boxes, received size, window, fullscreen); reports once
 * now and then on every real change. Returns the disposer.
 */
export function observeVideoFrame(container: Boxed, video: VideoLike, onChange: (g: VideoGeometry) => void, env: FrameObserverEnv = browserEnv()): () => void {
  let last: VideoGeometry | undefined;
  const measure = () => {
    const c = container.getBoundingClientRect();
    const media = { width: video.videoWidth || 0, height: video.videoHeight || 0 };
    const next: VideoGeometry = { box: { width: c.width, height: c.height }, media, frame: frameInContainer(c, video.getBoundingClientRect(), media) };
    if (last && sameGeometry(last, next)) return;
    last = next;
    onChange(next);
  };
  measure();
  const observer = env.ResizeObserver ? new env.ResizeObserver(measure) : undefined;
  observer?.observe(container as never);
  observer?.observe(video as never);
  for (const e of VIDEO_EVENTS) video.addEventListener(e, measure);
  env.window?.addEventListener("resize", measure);
  env.document?.addEventListener("fullscreenchange", measure);
  return () => {
    observer?.disconnect();
    for (const e of VIDEO_EVENTS) video.removeEventListener(e, measure);
    env.window?.removeEventListener("resize", measure);
    env.document?.removeEventListener("fullscreenchange", measure);
  };
}

function browserEnv(): FrameObserverEnv {
  return {
    ResizeObserver: typeof ResizeObserver === "function" ? ResizeObserver : undefined,
    window: typeof window === "undefined" ? undefined : window,
    document: typeof document === "undefined" ? undefined : document,
  };
}

/** Where a frame layer goes: the displayed frame, else (with `fallback`) the workspace fitted into the container. */
export function layerRect(g: VideoGeometry, fallback?: Size): Rect | null {
  if (g.frame) return g.frame;
  return fallback ? containedFrame(g.box, fallback) : null;
}
