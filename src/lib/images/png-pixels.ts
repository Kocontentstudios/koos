import { deflateSync, inflateSync } from "node:zlib";

/**
 * PNG bytes to RGBA pixels.
 *
 * There is no image-processing library available to application code — sharp
 * is a transitive dependency of Next and is not resolvable — but next/og
 * bundles resvg, so everything we rasterise comes back as a PNG we then have
 * no way to look at. That gap is why a logo resvg silently declined to draw
 * was indistinguishable from one it drew (KOOS-BUG-022): the render succeeded,
 * the bytes were a valid PNG, and nothing could tell that the corner was
 * empty.
 *
 * Deliberately narrow. This reads what resvg emits — 8-bit, non-interlaced —
 * and returns null for anything else rather than pretending to be a decoder.
 */

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Comfortably past a 4096x4096 RGBA frame, nowhere near a decompression bomb. */
const MAX_INFLATED_BYTES = 96 * 1024 * 1024;

const CHANNELS: Record<number, number> = {
  0: 1, // greyscale
  2: 3, // RGB
  3: 1, // palette index
  4: 2, // greyscale + alpha
  6: 4, // RGBA
};

/* An RGBA buffer is four bytes a pixel, so a small file declaring a huge frame
   can ask for hundreds of megabytes before anything rejects it: a 29KB
   greyscale PNG claiming 5000x6000 decoded into 120MB. Eight megapixels is
   comfortably above the largest canvas this app renders (1080x1920) and above
   any sane logo, at a 32MB ceiling. */
const MAX_PIXELS = 8 * 1024 * 1024;

export interface DecodedPng {
  width: number;
  height: number;
  /** Row-major RGBA, four bytes per pixel. */
  pixels: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-scanline filter in place, which is how PNG stores rows. */
function unfilter(
  raw: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer | null {
  const stride = width * bytesPerPixel;
  if (raw.length < height * (stride + 1)) return null;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;

    for (let i = 0; i < stride; i += 1) {
      const x = raw[src + i];
      const left = i >= bytesPerPixel ? out[dst + i - bytesPerPixel] : 0;
      const above = y > 0 ? out[up + i] : 0;
      const upLeft =
        y > 0 && i >= bytesPerPixel ? out[up + i - bytesPerPixel] : 0;
      switch (filter) {
        case 0:
          out[dst + i] = x;
          break;
        case 1:
          out[dst + i] = (x + left) & 0xff;
          break;
        case 2:
          out[dst + i] = (x + above) & 0xff;
          break;
        case 3:
          out[dst + i] = (x + ((left + above) >> 1)) & 0xff;
          break;
        case 4:
          out[dst + i] = (x + paeth(left, above, upLeft)) & 0xff;
          break;
        default:
          return null;
      }
    }
  }
  return out;
}

/* tRNS on a non-palette image names ONE colour that means transparent, stored
   as 16-bit samples. A greyscale or RGB logo with keyed transparency read as
   fully opaque, so it was never cropped and its whole frame counted as ink. */
function keyedOut(
  transparency: Uint8Array | null,
  colorType: number,
  raw: Buffer,
  from: number,
): boolean {
  if (!transparency) return false;
  if (colorType === 0) {
    return transparency.length >= 2 && raw[from] === transparency[1];
  }
  if (colorType === 2) {
    return (
      transparency.length >= 6 &&
      raw[from] === transparency[1] &&
      raw[from + 1] === transparency[3] &&
      raw[from + 2] === transparency[5]
    );
  }
  return false;
}

export function decodePngRgba(bytes: Uint8Array): DecodedPng | null {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  /* PNG-8 is a common logo export, and palette entries live in their own
     chunk. Without PLTE the image decodes as index numbers, which read as a
     near-black smear; without tRNS its transparent entries come back opaque
     and the mark arrives on a solid rectangle. */
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Buffer[] = [];

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const body = offset + 8;
    if (body + length > bytes.length) return null;

    if (type === "IHDR") {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      const bitDepth = bytes[body + 8];
      colorType = bytes[body + 9];
      const interlace = bytes[body + 12];
      if (bitDepth !== 8 || interlace !== 0) return null;
      if (!(colorType in CHANNELS)) return null;
      if (width * height > MAX_PIXELS) return null;
    } else if (type === "PLTE") {
      palette = bytes.subarray(body, body + length);
    } else if (type === "tRNS") {
      transparency = bytes.subarray(body, body + length);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(bytes.subarray(body, body + length)));
    } else if (type === "IEND") {
      break;
    }
    offset = body + length + 4; // + CRC
  }

  if (width <= 0 || height <= 0 || idat.length === 0) return null;

  let raw: Buffer;
  try {
    /* Bounded: a small PNG can declare an IDAT that inflates to hundreds of
       megabytes, and unfilter would only reject it after the allocation. */
    raw = inflateSync(Buffer.concat(idat), {
      maxOutputLength: MAX_INFLATED_BYTES,
    });
  } catch {
    return null;
  }

  if (colorType === 3 && !palette) return null;
  const channels = CHANNELS[colorType];
  const unfiltered = unfilter(raw, width, height, channels);
  if (!unfiltered) return null;

  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const from = i * channels;
    const to = i * 4;
    if (colorType === 6) {
      pixels.set(unfiltered.subarray(from, from + 4), to);
    } else if (colorType === 3 && palette) {
      const index = unfiltered[from];
      pixels[to] = palette[index * 3] ?? 0;
      pixels[to + 1] = palette[index * 3 + 1] ?? 0;
      pixels[to + 2] = palette[index * 3 + 2] ?? 0;
      pixels[to + 3] = transparency?.[index] ?? 255;
    } else if (colorType === 2) {
      pixels.set(unfiltered.subarray(from, from + 3), to);
      pixels[to + 3] = keyedOut(transparency, colorType, unfiltered, from)
        ? 0
        : 255;
    } else if (colorType === 0) {
      const grey = unfiltered[from];
      pixels[to] = grey;
      pixels[to + 1] = grey;
      pixels[to + 2] = grey;
      pixels[to + 3] = keyedOut(transparency, colorType, unfiltered, from)
        ? 0
        : 255;
    } else {
      const grey = unfiltered[from];
      pixels[to] = grey;
      pixels[to + 1] = grey;
      pixels[to + 2] = grey;
      pixels[to + 3] = unfiltered[from + 1];
    }
  }

  return { width, height, pixels };
}

export interface InkReading {
  /** Share of pixels with meaningful alpha. Zero means nothing was drawn. */
  coverage: number;
  /** Mean relative luminance of those pixels, 0–1. NaN when none are opaque. */
  luminance: number;
  /** Darkest and lightest ink, at the 5th and 95th percentiles.
   *
   * A mean is useless for deciding legibility: a mark with dark glyphs and
   * light lettering averages to a mid-tone that matches nothing actually on
   * the page, so it reads as needing rescue and then gets a plate chosen for a
   * tone neither half has. Percentiles rather than absolute extremes, because
   * one antialiased pixel should not define the mark. */
  darkest: number;
  lightest: number;
}

const OPAQUE_ENOUGH = 32;

/** sRGB relative luminance, the quantity WCAG contrast is defined over. */
function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** How much ink a render actually put down, and how light it is. */
const DARK_PERCENTILE = 0.05;
const LIGHT_PERCENTILE = 0.95;

export function readInk({ width, height, pixels }: DecodedPng): InkReading {
  const values: number[] = [];
  let total = 0;
  for (let i = 0; i < width * height; i += 1) {
    const at = i * 4;
    if (pixels[at + 3] < OPAQUE_ENOUGH) continue;
    const luminance =
      0.2126 * channelLuminance(pixels[at]) +
      0.7152 * channelLuminance(pixels[at + 1]) +
      0.0722 * channelLuminance(pixels[at + 2]);
    values.push(luminance);
    total += luminance;
  }

  if (values.length === 0) {
    return {
      coverage: 0,
      luminance: Number.NaN,
      darkest: Number.NaN,
      lightest: Number.NaN,
    };
  }

  values.sort((a, b) => a - b);
  const at = (share: number) =>
    values[
      Math.min(values.length - 1, Math.floor(share * (values.length - 1)))
    ];

  return {
    coverage: values.length / (width * height),
    luminance: total / values.length,
    darkest: at(DARK_PERCENTILE),
    lightest: at(LIGHT_PERCENTILE),
  };
}

export interface InkBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The bounding box of everything actually drawn.
 *
 * A logo file is usually bigger than its mark — exported with an artboard, or
 * with clear space baked in. Fitting the FILE into the logo box then shrinks
 * the mark by however much padding it happens to carry, which is why a 1000px
 * artboard holding an 80px mark arrived on the design 12 pixels wide.
 */
export function inkBoxOf({ width, height, pixels }: DecodedPng): InkBox | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] < OPAQUE_ENOUGH) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return null;
  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(
    crc32(Buffer.concat([head.subarray(4), Buffer.from(data)])),
    0,
  );
  return Buffer.concat([head, Buffer.from(data), tail]);
}

/** RGBA pixels back to a PNG, so a decoded image can be changed and re-used. */
export function encodePngRgba({
  width,
  height,
  pixels,
}: DecodedPng): Uint8Array {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.subarray(y * width * 4, (y + 1) * width * 4)).copy(
      raw,
      y * (width * 4 + 1) + 1,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Cuts a region out of decoded pixels. */
export function cropRgba(image: DecodedPng, box: InkBox): DecodedPng {
  const pixels = new Uint8Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.top + y) * image.width + box.left) * 4;
    pixels.set(
      image.pixels.subarray(from, from + box.width * 4),
      y * box.width * 4,
    );
  }
  return { width: box.width, height: box.height, pixels };
}

/**
 * The luminance RANGE of a pixel region, as the 5th and 95th percentiles.
 *
 * A mean is the wrong instrument here for the same reason it is wrong for the
 * mark's own ink: a corner that is half bright sky and half dark silhouette
 * averages to a mid-tone that appears on neither half, so a black mark laid
 * across it is judged legible and is invisible over half its area. What the
 * mark has to survive is the ground's extremes, not its average.
 */
export function regionInk(
  image: DecodedPng,
  box: { left: number; top: number; width: number; height: number },
): { darkest: number; lightest: number } {
  const { width, height, pixels } = image;
  const left = Math.max(0, Math.round(box.left));
  const top = Math.max(0, Math.round(box.top));
  const right = Math.min(width, Math.round(box.left + box.width));
  const bottom = Math.min(height, Math.round(box.top + box.height));

  const values: number[] = [];
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * width + x) * 4;
      if (pixels[at + 3] < OPAQUE_ENOUGH) continue;
      values.push(
        0.2126 * channelLuminance(pixels[at]) +
          0.7152 * channelLuminance(pixels[at + 1]) +
          0.0722 * channelLuminance(pixels[at + 2]),
      );
    }
  }
  if (values.length === 0) {
    return { darkest: Number.NaN, lightest: Number.NaN };
  }

  values.sort((a, b) => a - b);
  const at = (share: number) =>
    values[
      Math.min(values.length - 1, Math.floor(share * (values.length - 1)))
    ];
  return { darkest: at(DARK_PERCENTILE), lightest: at(LIGHT_PERCENTILE) };
}

/** Mean luminance of the opaque pixels inside a pixel region, or NaN when the
 * region holds none. */
export function regionLuminance(
  { width, height, pixels }: DecodedPng,
  box: { left: number; top: number; width: number; height: number },
): number {
  const left = Math.max(0, Math.round(box.left));
  const top = Math.max(0, Math.round(box.top));
  const right = Math.min(width, Math.round(box.left + box.width));
  const bottom = Math.min(height, Math.round(box.top + box.height));

  let total = 0;
  let counted = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const at = (y * width + x) * 4;
      if (pixels[at + 3] < OPAQUE_ENOUGH) continue;
      counted += 1;
      total +=
        0.2126 * channelLuminance(pixels[at]) +
        0.7152 * channelLuminance(pixels[at + 1]) +
        0.0722 * channelLuminance(pixels[at + 2]);
    }
  }
  return counted === 0 ? Number.NaN : total / counted;
}
