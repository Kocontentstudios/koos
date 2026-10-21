import { crc32, deflateSync } from "node:zlib";
import { type PngHeader, pngScanlineLayout } from "./decode-check";

/**
 * Real PNG and JPEG bytes for upload tests, built rather than checked in (no
 * binaries in the repo). Both decode in a real decoder: the PNG through any
 * zlib, the JPEG through satori and resvg, which is what makes them worth more
 * than a header stub that only a header reader would accept.
 */

export const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

export function pngChunk(type: string, data: Uint8Array = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

export function ihdrChunk(header: PngHeader): Buffer {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(header.width, 0);
  data.writeUInt32BE(header.height, 4);
  data[8] = header.bitDepth;
  data[9] = header.colourType;
  data[12] = header.interlaced ? 1 : 0;
  return pngChunk("IHDR", data);
}

/** The filtered scanlines the header promises: filter 0, all-zero samples. */
export function rawScanlines(header: PngHeader): Buffer {
  const size = pngScanlineLayout(header).reduce(
    (sum, run) => sum + run.bytes * run.count,
    0,
  );
  return Buffer.alloc(size);
}

export interface PngOptions {
  bitDepth?: number;
  colourType?: number;
  interlaced?: boolean;
  /** Replaces the deflated scanlines, for corrupt-stream cases. */
  idat?: Uint8Array;
}

export function buildPng(
  width: number,
  height: number,
  options: PngOptions = {},
): Buffer {
  const header: PngHeader = {
    width,
    height,
    bitDepth: options.bitDepth ?? 8,
    colourType: options.colourType ?? 6,
    interlaced: options.interlaced ?? false,
  };
  const palette =
    header.colourType === 3 ? [pngChunk("PLTE", Buffer.alloc(3, 0x80))] : [];
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdrChunk(header),
    ...palette,
    pngChunk("IDAT", options.idat ?? deflateSync(rawScanlines(header))),
    pngChunk("IEND"),
  ]);
}

/* A baseline greyscale JPEG whose every 8x8 block is flat mid-grey. Each
   Huffman table holds one 1-bit code: DC category 0 and AC end-of-block. So a
   block is the two bits "00", and the scan is all zero bytes with the final
   byte padded with ones, as the format requires. */
const JPEG_SOI = [0xff, 0xd8];
const JPEG_EOI = [0xff, 0xd9];
const JFIF_APP0 = [
  ...[0xff, 0xe0, 0x00, 0x10],
  ...Buffer.from("JFIF\0"),
  ...[1, 1, 0, 0, 1, 0, 1, 0, 0],
];
const QUANT_TABLE = [0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(1)];
const ONE_CODE_COUNTS = [1, ...new Array(15).fill(0)];
const DC_TABLE = [0xff, 0xc4, 0x00, 0x14, 0x00, ...ONE_CODE_COUNTS, 0x00];
const AC_TABLE = [0xff, 0xc4, 0x00, 0x14, 0x10, ...ONE_CODE_COUNTS, 0x00];
const SCAN_HEADER = [
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
];

function frameHeader(width: number, height: number): number[] {
  return [
    ...[0xff, 0xc0, 0x00, 0x0b, 0x08],
    ...[(height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff],
    ...[0x01, 0x01, 0x11, 0x00],
  ];
}

function flatScan(width: number, height: number): number[] {
  const bits = Math.ceil(width / 8) * Math.ceil(height / 8) * 2;
  const scan: number[] = new Array(Math.ceil(bits / 8)).fill(0);
  scan[scan.length - 1] |= (1 << (scan.length * 8 - bits)) - 1;
  return scan;
}

export interface JpegParts {
  soi: number[];
  app0: number[];
  tables: number[];
  frame: number[];
  scanHeader: number[];
  scan: number[];
  eoi: number[];
}

/** The segments of buildJpeg, for tests that drop or damage one. */
export function jpegParts(width: number, height: number): JpegParts {
  return {
    soi: JPEG_SOI,
    app0: JFIF_APP0,
    tables: [...QUANT_TABLE, ...DC_TABLE, ...AC_TABLE],
    frame: frameHeader(width, height),
    scanHeader: SCAN_HEADER,
    scan: flatScan(width, height),
    eoi: JPEG_EOI,
  };
}

export function joinJpeg(parts: Partial<JpegParts>): Buffer {
  return Buffer.from([
    ...(parts.soi ?? []),
    ...(parts.app0 ?? []),
    ...(parts.tables ?? []),
    ...(parts.frame ?? []),
    ...(parts.scanHeader ?? []),
    ...(parts.scan ?? []),
    ...(parts.eoi ?? []),
  ]);
}

export function buildJpeg(width: number, height: number): Buffer {
  return joinJpeg(jpegParts(width, height));
}
