import {
  hexChannels,
  relativeLuminance,
  rgbLuminance,
} from "@/lib/design/palette";

/**
 * What a photograph puts behind the copy, and the lightest veil that makes
 * the copy read over it.
 *
 * A fixed scrim has to assume the worst image, so the round-1 builder laid
 * black at 0.56-0.62 over every photograph: correct for white type over a
 * white plate, and it turned every bright photo flat grey. Here the actual
 * pixels under the copy decide. Each candidate text colour gets the least
 * veil (black under light type, white under dark type) at which every
 * sampled pixel clears the contrast target, and the candidate needing the
 * least wins. A bright photo gets dark type and no veil; a dark one gets
 * white type and no veil; only a busy one is veiled, and only as much as it
 * needs.
 */

/** Measured facts about an image, from image-facts.ts. Plain JSON. */
export interface ImageFacts {
  width: number;
  height: number;
  /** True when a share of the image is see-through: a cut-out subject, which
   *  is contained in its frame and never cropped. */
  cutout: boolean;
  /** Bounding box of the visible pixels, as shares of width and height. */
  ink: { left: number; top: number; right: number; bottom: number };
  /** The image downsampled to a coarse grid, row-major RGBA. Each cell is
   *  the average of the pixels it covers, which is the scale a reader's eye
   *  integrates a background at. */
  grid: { cols: number; rows: number; rgba: number[] };
}

export type Rgb = [number, number, number];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an image element puts its picture: the same arithmetic render.tsx
 *  hands satori (object-fit plus a focus offset). */
export interface ImagePlacement {
  frame: Rect;
  fit: "cover" | "contain";
  zoom: number;
  focusX: number;
  focusY: number;
}

/** The drawn image's rectangle on the canvas. For both fits the zoomed box
 *  and the object-position offsets compose to (frame - drawn) * focus. */
export function drawnImageRect(
  facts: Pick<ImageFacts, "width" | "height">,
  placement: ImagePlacement,
): Rect {
  const { frame, fit, zoom, focusX, focusY } = placement;
  const fill = fit === "cover" ? Math.max : Math.min;
  const scale =
    fill(frame.width / facts.width, frame.height / facts.height) * zoom;
  const width = facts.width * scale;
  const height = facts.height * scale;
  return {
    x: frame.x + (frame.width - width) * focusX,
    y: frame.y + (frame.height - height) * focusY,
    width,
    height,
  };
}

export const hexToRgb: (hex: string) => Rgb = hexChannels;

function cellAt(facts: ImageFacts, u: number, v: number) {
  const { cols, rows, rgba } = facts.grid;
  const col = Math.min(cols - 1, Math.max(0, Math.floor(u * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor(v * rows)));
  const at = (row * cols + col) * 4;
  return {
    rgb: [rgba[at], rgba[at + 1], rgba[at + 2]] as Rgb,
    a: rgba[at + 3],
  };
}

/**
 * The colours a reader sees inside `region`: the image where it is drawn
 * (composited over the canvas background where it is see-through), the
 * background everywhere else. Sampled on a grid finer than the image grid
 * so no cell under the region is skipped.
 */
export function groundSamples(
  facts: ImageFacts,
  placement: ImagePlacement,
  region: Rect,
  background: string,
): Rgb[] {
  const drawn = drawnImageRect(facts, placement);
  const frame = placement.frame;
  const base = hexToRgb(background);
  const stepX = Math.max(1, drawn.width / facts.grid.cols / 2);
  const stepY = Math.max(1, drawn.height / facts.grid.rows / 2);
  const samples: Rgb[] = [];
  for (let y = region.y; y <= region.y + region.height; y += stepY) {
    for (let x = region.x; x <= region.x + region.width; x += stepX) {
      const insideFrame =
        x >= frame.x &&
        x < frame.x + frame.width &&
        y >= frame.y &&
        y < frame.y + frame.height;
      const u = (x - drawn.x) / drawn.width;
      const v = (y - drawn.y) / drawn.height;
      if (!insideFrame || u < 0 || u >= 1 || v < 0 || v >= 1) {
        samples.push(base);
        continue;
      }
      const { rgb, a } = cellAt(facts, u, v);
      const alpha = a / 255;
      samples.push(rgb.map((c, i) => c * alpha + base[i] * (1 - alpha)) as Rgb);
    }
  }
  return samples;
}

/** A ground nothing is known about: it may be white or black anywhere, so
 *  the veil has to cover both, which is what the fixed scrim assumed. */
export const UNKNOWN_GROUND: Rgb[] = [
  [255, 255, 255],
  [0, 0, 0],
];

function luminance(rgb: Rgb): number {
  return rgbLuminance(...rgb);
}

function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** WCAG contrast of a text colour against one ground pixel. */
export function contrastOn(text: string, pixel: Rgb): number {
  return ratio(relativeLuminance(text), luminance(pixel));
}

/** WCAG AA for body text, with a small margin for antialiased edges. */
export const COPY_CONTRAST = 4.6;

export interface Veil {
  text: string;
  /** `#000000` under light text, `#FFFFFF` under dark text. */
  color: string;
  alpha: number;
}

/** The least veil alpha (0..1, in 0.01 steps) at which every sample clears
 *  `target` against `text`, or null when even a full veil does not. */
export function veilAlpha(
  samples: Rgb[],
  text: string,
  target = COPY_CONTRAST,
): { color: string; alpha: number } | null {
  const ink = relativeLuminance(text);
  const veil: Rgb = ink > 0.5 ? [0, 0, 0] : [255, 255, 255];
  const clears = (alpha: number) =>
    samples.every((sample) => {
      const seen = sample.map((c, i) => c + (veil[i] - c) * alpha) as Rgb;
      return ratio(luminance(seen), ink) >= target;
    });
  if (!clears(1)) return null;
  let low = 0;
  let high = 100;
  if (clears(0)) high = 0;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (clears(mid / 100)) high = mid;
    else low = mid;
  }
  return { color: ink > 0.5 ? "#000000" : "#FFFFFF", alpha: high / 100 };
}

/* A white veil reads as a washed-out photo long before a black one reads as
   a dark one, so dark type over a light veil has to save this much alpha to
   be chosen. On a bright photo it needs none and wins outright; on a busy
   one, where either needs a heavy veil, the photo stays deep. */
const LIGHT_VEIL_PENALTY = 0.15;

/**
 * The candidate text colour needing the least veil. Earlier candidates win
 * ties within 0.05, so the brand's own colour is kept when it costs about
 * the same as a neutral.
 */
export function bestVeil(samples: Rgb[], candidates: string[]): Veil {
  let best: Veil | null = null;
  const cost = (veil: Pick<Veil, "color" | "alpha">) =>
    veil.alpha + (veil.color === "#FFFFFF" ? LIGHT_VEIL_PENALTY : 0);
  for (const text of candidates) {
    const needed = veilAlpha(samples, text);
    if (!needed) continue;
    if (!best || cost(needed) < cost(best) - 0.05) {
      best = { text, ...needed };
    }
  }
  /* White over a full black veil always clears; unreachable with WHITE among
     the candidates, which every caller includes. */
  return best ?? { text: "#FFFFFF", color: "#000000", alpha: 1 };
}

/** rgba() for a veil at `alpha`, as the schema's colour grammar accepts. */
export function veilColor(veil: Pick<Veil, "color">, alpha: number): string {
  const [r, g, b] = hexToRgb(veil.color);
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
}
