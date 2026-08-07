import type { AspectRatio } from "@/lib/ai/image/types";

export interface Canvas {
  width: number;
  height: number;
}

/** Render sizes chosen to match the platform dimensions the brief generator
 * already emits (1080x1350 etc.), so a generated design drops straight into
 * the slot the calendar item asked for. */
const CANVASES: Record<AspectRatio, Canvas> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1200, height: 675 },
};

export function canvasFor(aspectRatio: AspectRatio): Canvas {
  return CANVASES[aspectRatio] ?? CANVASES["1:1"];
}
