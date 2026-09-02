import type { AspectRatio } from "@/lib/ai/image/types";

export interface Canvas {
  width: number;
  height: number;
}

/** Render sizes chosen to match the platform dimensions the brief generator
 * already emits (1080x1350 etc.), so a generated design drops straight into
 * the slot the calendar item asked for.
 *
 * Not raised further on purpose. The background plate is a ~1MP Stability
 * render, so a bigger canvas only upscales it — the portrait and square sizes
 * already sit at or just above the plate's native resolution, and buying
 * sharper vector text with a softer background is not a trade worth making
 * silently.  Landscape was the exception: at 1200x675 the canvas was SMALLER
 * than the 1344x768 plate and threw real pixels away. It now renders at
 * 1344x756 — the plate's full width, so nothing is discarded and nothing is
 * invented. The 12px of height is cropped by object-fit: cover, because the
 * plate comes back at 7:4 rather than a true 16:9 and something has to give. */
const CANVASES: Record<AspectRatio, Canvas> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1344, height: 756 },
};

export function canvasFor(aspectRatio: AspectRatio): Canvas {
  return CANVASES[aspectRatio] ?? CANVASES["1:1"];
}
