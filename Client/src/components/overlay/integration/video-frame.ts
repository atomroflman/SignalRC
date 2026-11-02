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
