import { crc32, createInflate } from "node:zlib";

/**
 * A cheap pre-filter for a PNG or JPEG that cannot be whole, run before the
 * real decode in reencodeImage.
 *
 * These checks run the parts of a decoder that can fail on a damaged file
 * (chunk framing and CRCs, the zlib stream, the JPEG marker chain) and skip
 * the parts that cannot (colour conversion, IDCT). They refuse a truncated
 * upload or a decompression bomb before libvips allocates for it, and they
 * catch truncations libpng would quietly pad out. They are NOT proof the
 * renderer can draw the file: its rasteriser (sharp/librsvg via next/og)
 * rejects well-framed files these accept, and panics on some. That proof is
 * the re-encode.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_MAX_CHUNK = 2 ** 31 - 1;
const IHDR_LENGTH = 13;
const MAX_FILTER_TYPE = 4;

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const BIT_DEPTHS: Record<number, number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
};

/* [xStart, yStart, xStep, yStep] for each Adam7 pass. */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colourType: number;
  interlaced: boolean;
}

/** A run of `count` scanlines of `bytes` each, filter byte included. */
export interface ScanlineRun {
  bytes: number;
  count: number;
}

function scanlineBytes(width: number, header: PngHeader): number {
  const bitsPerPixel = CHANNELS[header.colourType] * header.bitDepth;
  return 1 + Math.ceil((width * bitsPerPixel) / 8);
}

function passLength(size: number, start: number, step: number): number {
  return size > start ? Math.ceil((size - start) / step) : 0;
}

/**
 * The scanlines the IHDR promises, in stream order. An interlaced image is
 * seven reduced images one after another, and a pass with no columns or no
 * rows contributes nothing, not even filter bytes.
 */
export function pngScanlineLayout(header: PngHeader): ScanlineRun[] {
  if (!header.interlaced) {
    return [
      { bytes: scanlineBytes(header.width, header), count: header.height },
    ];
  }
  const runs: ScanlineRun[] = [];
  for (const [x0, y0, dx, dy] of ADAM7) {
    const width = passLength(header.width, x0, dx);
    const height = passLength(header.height, y0, dy);
    if (width > 0 && height > 0) {
      runs.push({ bytes: scanlineBytes(width, header), count: height });
    }
  }
  return runs;
}

export function inflatedPngSize(header: PngHeader): number {
  return pngScanlineLayout(header).reduce(
    (sum, run) => sum + run.bytes * run.count,
    0,
  );
}

interface PngStructure {
  header: PngHeader;
  idat: Buffer;
}

function isChunkType(bytes: Uint8Array, at: number): boolean {
  for (let i = at; i < at + 4; i += 1) {
    const c = bytes[i] | 0x20;
    if (c < 0x61 || c > 0x7a) return false;
  }
  return true;
}

function readIhdr(bytes: Uint8Array, body: number): PngHeader | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header: PngHeader = {
    width: view.getUint32(body),
    height: view.getUint32(body + 4),
    bitDepth: bytes[body + 8],
    colourType: bytes[body + 9],
    interlaced: bytes[body + 12] === 1,
  };
  const valid =
    header.width > 0 &&
    header.height > 0 &&
    header.width <= PNG_MAX_CHUNK &&
    header.height <= PNG_MAX_CHUNK &&
    (BIT_DEPTHS[header.colourType]?.includes(header.bitDepth) ?? false) &&
    bytes[body + 10] === 0 &&
    bytes[body + 11] === 0 &&
    bytes[body + 12] <= 1;
  return valid ? header : null;
}

/**
 * Walks every chunk to IEND, checking framing and CRC, and gathers the IDAT
 * stream. A truncated upload has no IEND; a polyglot (a PNG header followed by
 * HTML) fails the framing of its second chunk.
 */
export function readPngStructure(bytes: Uint8Array): PngStructure | null {
  if (PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | null = null;
  let hasPalette = false;
  const idat: Uint8Array[] = [];

  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const body = offset + 8;
    const end = body + length;
    if (length > PNG_MAX_CHUNK || end + 4 > bytes.length) return null;
    if (!isChunkType(bytes, offset + 4)) return null;
    if (crc32(bytes.subarray(offset + 4, end)) !== view.getUint32(end)) {
      return null;
    }
    const type = String.fromCharCode(...bytes.subarray(offset + 4, body));

    if (header === null) {
      if (type !== "IHDR" || length !== IHDR_LENGTH) return null;
      header = readIhdr(bytes, body);
      if (!header) return null;
    } else if (type === "PLTE") {
      hasPalette = true;
    } else if (type === "IDAT") {
      if (header.colourType === 3 && !hasPalette) return null;
      idat.push(bytes.subarray(body, end));
    } else if (type === "IEND") {
      return idat.length > 0 ? { header, idat: Buffer.concat(idat) } : null;
    }
    offset = end + 4;
  }
  return null;
}

/**
 * Inflates the IDAT stream without keeping it, failing the moment it exceeds
 * what the header promised, so a decompression bomb costs one zlib window
 * rather than the size it claims. Every scanline must open with a valid
 * filter type, and the stream must end exactly where the layout does.
 */
export function inflatesToLayout(
  idat: Buffer,
  layout: ScanlineRun[],
): Promise<boolean> {
  const expected = layout.reduce((sum, run) => sum + run.bytes * run.count, 0);
  return new Promise((resolve) => {
    const inflate = createInflate();
    let produced = 0;
    let run = 0;
    let rowsLeft = layout[0]?.count ?? 0;
    let posInRow = 0;
    let settled = false;

    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) inflate.destroy();
      resolve(ok);
    };

    inflate.on("data", (chunk: Buffer) => {
      if (settled) return;
      if (produced + chunk.length > expected) return settle(false);
      produced += chunk.length;
      let i = 0;
      while (i < chunk.length) {
        const rowBytes = layout[run].bytes;
        if (posInRow === 0 && chunk[i] > MAX_FILTER_TYPE) return settle(false);
        const step = Math.min(rowBytes - posInRow, chunk.length - i);
        i += step;
        posInRow += step;
        if (posInRow === rowBytes) {
          posInRow = 0;
          rowsLeft -= 1;
          if (rowsLeft === 0) {
            run += 1;
            rowsLeft = layout[run]?.count ?? 0;
          }
        }
      }
    });
    inflate.on("error", () => settle(false));
    inflate.on("end", () => settle(produced === expected));
    inflate.end(idat);
  });
}

export async function pngDecodes(bytes: Uint8Array): Promise<boolean> {
  const structure = readPngStructure(bytes);
  if (!structure) return false;
  return inflatesToLayout(structure.idat, pngScanlineLayout(structure.header));
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/* Huffman-coded baseline, extended and progressive frames, the only ones
   browsers draw. Lossless (C3), hierarchical (C5-C7) and arithmetic-coded
   (C9-CB, CD-CF) files are refused: the browser normaliser cannot open them,
   so none comes from it, and libvips decodes an arithmetic marker over
   Huffman data as noise without a single warning (round-4 critic C3). */
const DRAWABLE_FRAMES = new Set([0xc0, 0xc1, 0xc2]);
const SOS = 0xda;
const EOI = 0xd9;
const SOI = 0xd8;
const TEM = 0x01;

const isRestart = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

/* Inside entropy-coded data a literal 0xFF is always stuffed as FF 00, and
   restart markers sit between intervals, so the first other marker ends the
   scan. Returns its offset, or -1 when the file ends mid-scan. */
function endOfScan(bytes: Uint8Array, from: number): number {
  let at = bytes.indexOf(0xff, from);
  while (at !== -1 && at + 1 < bytes.length) {
    const next = bytes[at + 1];
    if (next === 0x00 || isRestart(next)) {
      at = bytes.indexOf(0xff, at + 2);
    } else if (next === 0xff) {
      at += 1;
    } else {
      return at;
    }
  }
  return -1;
}

/**
 * Walks the marker chain from SOI to EOI: a frame header, then at least one
 * scan after it, then the end marker. Bytes after EOI are ignored, as every
 * decoder does. A JPEG cut short by a failed upload has no EOI.
 */
export function jpegDecodes(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  let sawFrame = false;
  let sawScan = false;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    offset += 2;

    if (marker === EOI) return sawFrame && sawScan;
    if (marker === TEM || isRestart(marker)) continue;
    if (marker === 0x00 || marker === SOI) return false;
    if (offset + 2 > bytes.length) return false;
    const length = view.getUint16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) return false;

    if (SOF_MARKERS.has(marker)) {
      if (sawFrame || !DRAWABLE_FRAMES.has(marker)) return false;
      const components = bytes[offset + 7];
      if (length < 8 || components < 1 || length !== 8 + 3 * components) {
        return false;
      }
      sawFrame = true;
      offset = end;
    } else if (marker === SOS) {
      const components = bytes[offset + 2];
      if (!sawFrame || components < 1 || components > 4) return false;
      if (length !== 6 + 2 * components) return false;
      sawScan = true;
      offset = endOfScan(bytes, end);
      if (offset === -1) return false;
    } else {
      offset = end;
    }
  }
  return false;
}

/**
 * True when the JPEG's frame header, the first before any scan, is one
 * DRAWABLE_FRAMES excludes. A file whose segments cannot be walked to a frame
 * is not judged here: the structural check and the decoder refuse it.
 */
export function jpegHasUndrawableFrame(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== SOI) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset + 1] === 0xff) offset += 1;
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === TEM || isRestart(marker)) continue;
    if (marker === SOS || marker === EOI) return false;
    if (SOF_MARKERS.has(marker)) return !DRAWABLE_FRAMES.has(marker);
    if (offset + 2 > bytes.length) return false;
    offset += view.getUint16(offset);
  }
  return false;
}
