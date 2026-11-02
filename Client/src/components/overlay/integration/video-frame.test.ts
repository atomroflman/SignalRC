import { describe, expect, it } from "vitest";
import { containedFrame, frameInContainer, sameFrame } from "./video-frame";

describe("displayed video frame (object-fit: contain)", () => {
  it("pillarboxes a 4:3 frame in a 16:9 box and letterboxes a 16:9 frame in a 4:3 box", () => {
    expect(containedFrame({ width: 1600, height: 900 }, { width: 640, height: 480 })).toEqual({ left: 200, top: 0, width: 1200, height: 900 });
    expect(containedFrame({ width: 800, height: 600 }, { width: 1280, height: 720 })).toEqual({ left: 0, top: 75, width: 800, height: 450 });
  });

  it("fills a box of the same aspect ratio exactly, also when scaling up", () => {
    expect(containedFrame({ width: 1920, height: 1080 }, { width: 1280, height: 720 })).toEqual({ left: 0, top: 0, width: 1920, height: 1080 });
  });

  it("is null without received metadata or without a laid-out box", () => {
    expect(containedFrame({ width: 800, height: 600 }, { width: 0, height: 0 })).toBeNull();
    expect(containedFrame({ width: 0, height: 600 }, { width: 1280, height: 720 })).toBeNull();
    expect(containedFrame({ width: 800, height: 600 }, { width: NaN, height: 720 })).toBeNull();
  });

  it("is relative to the container when the video element is narrower than it (max-w-full, centred)", () => {
    // Container 1000 × 500 at (10, 20); video element h-full, centred, 700 wide.
    const container = { left: 10, top: 20, width: 1000, height: 500 };
    const video = { left: 160, top: 20, width: 700, height: 500 };
    // Received 1280 × 720: frame 700 × 393.75, vertically centred in the element.
    const frame = frameInContainer(container, video, { width: 1280, height: 720 })!;
    expect(frame.left).toBeCloseTo(150);
    expect(frame.top).toBeCloseTo((500 - 393.75) / 2);
    expect(frame.width).toBeCloseTo(700);
    expect(frame.height).toBeCloseTo(393.75);
  });

  it("follows the received size, not the configured camera resolution", () => {
    const box = { left: 0, top: 0, width: 1280, height: 720 };
    // Camera configured 1280 × 720 but the stream delivers a portrait 720 × 1280 frame.
    expect(frameInContainer(box, box, { width: 720, height: 1280 })).toEqual({ left: 437.5, top: 0, width: 405, height: 720 });
  });

  it("ignores sub-pixel changes so a resize observer does not loop", () => {
    const a = { left: 0, top: 75, width: 800, height: 450 };
    expect(sameFrame(a, { ...a, top: 75.2 })).toBe(true);
    expect(sameFrame(a, { ...a, width: 801 })).toBe(false);
    expect(sameFrame(null, null)).toBe(true);
    expect(sameFrame(a, null)).toBe(false);
  });
});
