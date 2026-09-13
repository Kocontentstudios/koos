import { deflateSync } from "node:zlib";
import type { DecodedPng } from "@/lib/images/png-pixels";

/**
 * Real PNG bytes for render tests.
 *
 * Built rather than checked in: a binary fixture cannot be committed here
 * (Safety: no binaries in the repo), and a stub the renderer cannot decode
 * would make a "logo drawn" assertion pass while drawing nothing. These are
 * genuine RGBA PNGs that satori decodes like any uploaded file.
 */

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
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, Buffer.from(data), tail]);
}

export interface LogoFixtureOptions {
  width: number;
  height: number;
  /** RGBA of the mark itself. */
  color?: [number, number, number, number];
  /** Leaves a transparent border, so alpha survival is observable. */
  transparentMargin?: number;
  shape?: LogoShape;
}

/**
 * Circles, not rectangles.
 *
 * A vision judge asked "is this mark distorted or cropped" cannot answer for a
 * bar or a block — every rectangle looks like a rectangle, and an L-shaped one
 * reads as a rectangle that got cut off. A ring squashed is visibly an
 * ellipse, and a ring cannot plausibly be a crop of anything, so the verdict
 * is about the renderer rather than about the fixture.
 */
export type LogoShape = "ring" | "discs" | "block";

function inShape(
  shape: LogoShape,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (shape === "block") return true;

  if (shape === "ring") {
    const r = Math.min(width, height) / 2;
    const dx = x - width / 2;
    const dy = y - height / 2;
    const d = Math.hypot(dx, dy);
    return d <= r && d >= r * 0.45;
  }

  // Three discs in a row: a horizontal mark whose parts must stay circular.
  const d = Math.min(width / 3, height);
  for (let i = 0; i < 3; i += 1) {
    const cx = d / 2 + i * (width / 3);
    if (Math.hypot(x - cx, y - height / 2) <= d / 2) return true;
  }
  return false;
}

/** A mark on a transparent ground — enough for satori to draw and for a vision
 * judge to see an orientation, without shipping an image file. */
export function logoPng({
  width,
  height,
  color = [230, 30, 90, 255],
  transparentMargin = 0,
  shape = "ring",
}: LogoFixtureOptions): Uint8Array {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const inMargin =
        x < transparentMargin ||
        y < transparentMargin ||
        x >= width - transparentMargin ||
        y >= height - transparentMargin;
      const at = rowStart + 1 + x * 4;
      if (!inMargin && inShape(shape, x + 0.5, y + 0.5, width, height)) {
        raw[at] = color[0];
        raw[at + 1] = color[1];
        raw[at + 2] = color[2];
        raw[at + 3] = color[3];
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** A square mark and a 4:1 wordmark — the two shapes a fixed logo box has to
 * place without stretching either. */
export const SQUARE_MARK = () =>
  logoPng({ width: 256, height: 256, shape: "ring" });
export const WORDMARK = () =>
  logoPng({ width: 384, height: 128, shape: "discs" });
export const TRANSPARENT_MARK = () =>
  logoPng({ width: 256, height: 256, transparentMargin: 64, shape: "block" });

/**
 * Where the mark actually landed in a rendered design, measured in pixels.
 *
 * Asserting that two renders differ proves almost nothing — it holds with the
 * alpha flattened, with the mark stretched to fill its box, and with it drawn
 * on top of the headline. The criteria are geometric, so the assertions have
 * to be too.
 */
export interface InkBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  ratio: number;
  pixels: number;
}

/** Bounding box of everything that is not the given ground colour, within an
 * optional region. */
export function inkBounds(
  decoded: DecodedPng,
  ground: [number, number, number],
  region?: { left: number; top: number; right: number; bottom: number },
): InkBounds | null {
  const { width, height, pixels } = decoded;
  const area = region ?? { left: 0, top: 0, right: width, bottom: height };
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let count = 0;

  for (
    let y = Math.max(0, area.top);
    y < Math.min(height, area.bottom);
    y += 1
  ) {
    for (
      let x = Math.max(0, area.left);
      x < Math.min(width, area.right);
      x += 1
    ) {
      const at = (y * width + x) * 4;
      const differs =
        Math.abs(pixels[at] - ground[0]) > TOLERANCE ||
        Math.abs(pixels[at + 1] - ground[1]) > TOLERANCE ||
        Math.abs(pixels[at + 2] - ground[2]) > TOLERANCE;
      if (!differs) continue;
      count += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  if (right < 0) return null;
  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  return {
    left,
    top,
    right,
    bottom,
    width: boxWidth,
    height: boxHeight,
    ratio: boxWidth / boxHeight,
    pixels: count,
  };
}

/* Antialiasing and PNG quantisation move a flat fill by a point or two. */
const TOLERANCE = 6;

/**
 * Where two renders differ — which, for a pair that differs only by the logo,
 * is exactly the mark.
 *
 * More honest than a bounding box over "everything that is not the background
 * colour": a layout may draw a border or a scrim through the same corner, and
 * that ink would be counted as part of the logo.
 */
export function diffBounds(a: DecodedPng, b: DecodedPng): InkBounds | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  let left = a.width;
  let top = a.height;
  let right = -1;
  let bottom = -1;
  let count = 0;

  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const at = (y * a.width + x) * 4;
      const differs =
        Math.abs(a.pixels[at] - b.pixels[at]) > TOLERANCE ||
        Math.abs(a.pixels[at + 1] - b.pixels[at + 1]) > TOLERANCE ||
        Math.abs(a.pixels[at + 2] - b.pixels[at + 2]) > TOLERANCE;
      if (!differs) continue;
      count += 1;
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
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
    ratio: (right - left + 1) / (bottom - top + 1),
    pixels: count,
  };
}
