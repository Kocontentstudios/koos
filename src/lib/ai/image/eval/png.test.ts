import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  BLANK_MAX_BYTES_PER_PIXEL,
  bytesPerPixel,
  isPng,
  looksBlank,
  readPngSize,
} from "./png";

/** Builds a real solid-colour PNG so the blankness threshold is exercised
 * against actual zlib output rather than a hand-picked number. */
function solidPng(width: number, height: number): Buffer {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc32 = (buf: Buffer) => {
    let x = 0xffffffff;
    for (const b of buf) x = table[(x ^ b) & 0xff] ^ (x >>> 8);
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([len, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3), 0);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("readPngSize", () => {
  it("reads dimensions straight out of the IHDR header", () => {
    expect(readPngSize(solidPng(896, 1200))).toEqual({
      width: 896,
      height: 1200,
    });
  });

  it("handles the non-square orientations the adapter produces", () => {
    expect(readPngSize(solidPng(1376, 768))?.width).toBe(1376);
    expect(readPngSize(solidPng(768, 1376))?.height).toBe(1376);
  });

  it("returns null for a non-PNG rather than reading garbage offsets", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(readPngSize(jpeg)).toBeNull();
  });

  it("returns null for a truncated file", () => {
    expect(readPngSize(solidPng(100, 100).subarray(0, 12))).toBeNull();
  });
});

describe("isPng", () => {
  it("matches the signature", () => {
    expect(isPng(solidPng(8, 8))).toBe(true);
    expect(isPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });
});

describe("looksBlank", () => {
  it("flags a genuinely flat frame", () => {
    const png = solidPng(1024, 1024);
    const size = readPngSize(png);
    if (!size) throw new Error("fixture should parse");
    expect(looksBlank(png, size)).toBe(true);
    // Documents the measured floor: solid output lands near 0.003 B/px.
    expect(bytesPerPixel(png.length, size)).toBeLessThan(0.01);
  });

  it("passes densities matching real generated designs", () => {
    const size = { width: 1024, height: 1024 };
    // 0.622 B/px was the least detailed real sample (a soft gradient plate).
    const realistic = new Uint8Array(Math.round(0.622 * 1024 * 1024));
    expect(looksBlank(realistic, size)).toBe(false);
  });

  it("keeps the threshold between the measured blank and real floors", () => {
    expect(BLANK_MAX_BYTES_PER_PIXEL).toBeGreaterThan(0.003);
    expect(BLANK_MAX_BYTES_PER_PIXEL).toBeLessThan(0.622);
  });
});
