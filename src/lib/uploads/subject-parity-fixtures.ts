import sharp from "sharp";

/**
 * Fine patterns for the subject check's browser/server parity (round-5
 * review): the shapes on which two resamplers disagree most, at contrasts
 * either side of the check's thresholds (a deviation of 24, an edge energy of
 * 8). Built in memory and deterministic (no binaries in the repo). Each is
 * the RGBA a browser canvas would hold after drawing the picked file, before
 * it is encoded and uploaded.
 */

export interface ParityPattern {
  name: string;
  width: number;
  height: number;
  /** Unpremultiplied RGBA. */
  rgba: Uint8Array;
}

export const PARITY_WIDTH = 1600;
export const PARITY_HEIGHT = 1200;

/* Either side of 8 (edge energy) and 24 (deviation), then plainly over. */
export const PARITY_CONTRASTS = [4, 8, 12, 20, 28, 48, 255] as const;

const BASE = 200;

type Shape = (x: number, y: number) => number;

/* 0 or 1 at each pixel: which of the two tones it takes. */
const SHAPES: Record<string, Shape> = {
  "checker-1px": (x, y) => (x + y) % 2,
  "checker-2px": (x, y) => (Math.floor(x / 2) + Math.floor(y / 2)) % 2,
  "checker-5px": (x, y) => (Math.floor(x / 5) + Math.floor(y / 5)) % 2,
  /* One thumbnail cell (25 px), then a period just off it, which beats. */
  "checker-25px": (x, y) => (Math.floor(x / 25) + Math.floor(y / 25)) % 2,
  "checker-24px": (x, y) => (Math.floor(x / 24) + Math.floor(y / 24)) % 2,
  "stripes-v-1px": (x) => x % 2,
  "stripes-v-3px": (x) => Math.floor(x / 3) % 2,
  "stripes-h-50px": (_x, y) => Math.floor(y / 50) % 2,
  "stripes-h-26px": (_x, y) => Math.floor(y / 26) % 2,
  "stripes-diag-4px": (x, y) => Math.floor((x + y) / 4) % 2,
  "stripes-diag-37px": (x, y) => Math.floor((x - y + 10_000) / 37) % 2,
  "halftone-6px": halftone(6, 0.3),
  "halftone-12px": halftone(12, 0.45),
  "halftone-40px-sparse": halftone(40, 0.15),
};

function halftone(pitch: number, radiusShare: number): Shape {
  const radius = pitch * radiusShare;
  return (x, y) => {
    const dx = (x % pitch) - pitch / 2;
    const dy = (y % pitch) - pitch / 2;
    return dx * dx + dy * dy <= radius * radius ? 1 : 0;
  };
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function fromShape(shape: Shape, contrast: number): Uint8Array {
  const rgba = new Uint8Array(PARITY_WIDTH * PARITY_HEIGHT * 4);
  for (let y = 0; y < PARITY_HEIGHT; y += 1) {
    for (let x = 0; x < PARITY_WIDTH; x += 1) {
      const v = BASE - shape(x, y) * contrast;
      rgba.set([v, v, Math.min(255, v + 10), 255], (y * PARITY_WIDTH + x) * 4);
    }
  }
  return rgba;
}

/* Noise whose features are `feature` px across: white noise at 1, blotches
   the size of a thumbnail cell and larger above it. */
async function noise(
  feature: number,
  contrast: number,
  seed: number,
): Promise<Uint8Array> {
  const next = seeded(seed);
  const w = Math.ceil(PARITY_WIDTH / feature);
  const h = Math.ceil(PARITY_HEIGHT / feature);
  const small = Buffer.from(
    Array.from({ length: w * h }, () => Math.round(next() * 255)),
  );
  const grey =
    feature === 1
      ? small
      : await sharp(small, { raw: { width: w, height: h, channels: 1 } })
          .resize(PARITY_WIDTH, PARITY_HEIGHT, { kernel: "cubic" })
          .raw()
          .toBuffer();
  const rgba = new Uint8Array(PARITY_WIDTH * PARITY_HEIGHT * 4);
  for (let i = 0; i < PARITY_WIDTH * PARITY_HEIGHT; i += 1) {
    const v = Math.round(BASE - (grey[i] / 255) * contrast);
    rgba.set([v, v, v, 255], i * 4);
  }
  return rgba;
}

/* A fine alpha pattern on transparency: the PNG path, where the stored file
   is lossless and only the alpha compositing can differ. */
function alphaChecker(contrast: number): Uint8Array {
  const rgba = new Uint8Array(PARITY_WIDTH * PARITY_HEIGHT * 4);
  for (let y = 0; y < PARITY_HEIGHT; y += 1) {
    for (let x = 0; x < PARITY_WIDTH; x += 1) {
      const on = (Math.floor(x / 3) + Math.floor(y / 3)) % 2;
      rgba.set(
        [255, 255, 255, 255 - on * contrast],
        (y * PARITY_WIDTH + x) * 4,
      );
    }
  }
  return rgba;
}

type Paint = (x: number, y: number) => [number, number, number];

function painted(width: number, height: number, paint: Paint): ParityPattern {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba.set([...paint(x, y), 255], (y * width + x) * 4);
    }
  }
  return { name: "", width, height, rgba };
}

/**
 * The four images round 6 refused as blank on both paths (round-6 review,
 * B1), rebuilt as the review's generator drew them, at their original sizes:
 * fine high-contrast patterns that average to flat grey on the thumbnail.
 * Painted one at a time, since the pinstripe alone is 48 MB of RGBA.
 */
export function* roundSixRefusedPatterns(): Generator<ParityPattern> {
  yield {
    ...painted(2400, 1800, (x, y) =>
      (Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? [0, 0, 0] : [255, 255, 255],
    ),
    name: "b1 checker-6px-hi",
  };
  yield {
    ...painted(2400, 1800, (x) =>
      (x >> 1) & 1 ? [20, 20, 20] : [235, 235, 235],
    ),
    name: "b1 stripes-2px-hi",
  };
  yield {
    ...painted(1200, 1200, (x, y) =>
      ((x >> 3) + (y >> 3)) & 1 ? [230, 230, 230] : [40, 40, 40],
    ),
    name: "b1 pattern-heavy-8px-1200",
  };
  const next = seeded(3);
  const weave = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  yield {
    ...painted(4000, 3000, (x) => {
      const n = (next() - 0.5) * 20;
      return x % 8 === 0
        ? [weave(200 + n), weave(200 + n), weave(210 + n)]
        : [weave(20 + n), weave(30 + n), weave(70 + n)];
    }),
    name: "b1 pinstripe-navy-4000",
  };
}

export async function* parityPatterns(): AsyncGenerator<ParityPattern> {
  const pattern = (name: string, rgba: Uint8Array): ParityPattern => ({
    name,
    width: PARITY_WIDTH,
    height: PARITY_HEIGHT,
    rgba,
  });
  for (const contrast of PARITY_CONTRASTS) {
    for (const [shape, fn] of Object.entries(SHAPES)) {
      yield pattern(`${shape} c${contrast}`, fromShape(fn, contrast));
    }
    for (const feature of [1, 3, 25, 60]) {
      yield pattern(
        `noise-${feature}px c${contrast}`,
        await noise(feature, contrast, feature * 1000 + contrast),
      );
    }
    yield pattern(`alpha-checker-3px c${contrast}`, alphaChecker(contrast));
  }
  yield* roundSixRefusedPatterns();
}

export function hasTransparency({ rgba }: ParityPattern): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 255) return true;
  return false;
}
