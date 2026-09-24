import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { logoPng } from "@/lib/design/render/logo-fixtures";
import {
  cropRgba,
  decodePngRgba,
  encodePngRgba,
  inkBoxOf,
  readInk,
  regionLuminance,
} from "@/lib/images/png-pixels";

describe("decodePngRgba", () => {
  it("round-trips through the encoder", () => {
    const original = decodePngRgba(logoPng({ width: 16, height: 8 }));
    expect(original).not.toBeNull();
    if (!original) return;
    const again = decodePngRgba(encodePngRgba(original));
    expect(again).toMatchObject({ width: 16, height: 8 });
    expect(again?.pixels).toEqual(original.pixels);
  });

  /* Deliberately narrow: it reads what resvg emits and refuses the rest,
     rather than pretending to be a general decoder. */
  it.each([
    ["not a png", new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])],
    ["empty", new Uint8Array()],
    ["header only", logoPng({ width: 4, height: 4 }).slice(0, 20)],
  ])("returns null for %s", (_label, bytes) => {
    expect(decodePngRgba(bytes)).toBeNull();
  });

  it("returns null rather than guessing at an unsupported bit depth", () => {
    const bytes = logoPng({ width: 4, height: 4 });
    bytes[24] = 16; // IHDR bit depth
    expect(decodePngRgba(bytes)).toBeNull();
  });

  it("returns null for an interlaced image", () => {
    const bytes = logoPng({ width: 4, height: 4 });
    bytes[28] = 1; // IHDR interlace
    expect(decodePngRgba(bytes)).toBeNull();
  });

  /* A small file can declare an IDAT that inflates to hundreds of megabytes.
     The bound has to sit before the allocation, not after it. */
  it("refuses a decompression bomb instead of allocating it", () => {
    const huge = logoPng({ width: 2, height: 2 });
    const view = new DataView(huge.buffer);
    view.setUint32(16, 40000); // IHDR width
    view.setUint32(20, 40000); // IHDR height
    expect(decodePngRgba(huge)).toBeNull();
  });
});

describe("readInk", () => {
  it("reports nothing drawn for a fully transparent image", () => {
    const decoded = decodePngRgba(
      logoPng({ width: 8, height: 8, color: [0, 0, 0, 0] }),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    const ink = readInk(decoded);
    expect(ink.coverage).toBe(0);
    expect(Number.isNaN(ink.luminance)).toBe(true);
  });

  it("separates a light mark from a dark one", () => {
    const read = (color: [number, number, number, number]) => {
      const d = decodePngRgba(
        logoPng({ width: 8, height: 8, shape: "block", color }),
      );
      return d ? readInk(d).luminance : Number.NaN;
    };
    expect(read([255, 255, 255, 255])).toBeGreaterThan(0.9);
    expect(read([0, 0, 0, 255])).toBeLessThan(0.01);
  });
});

describe("inkBoxOf", () => {
  it("finds the mark inside its transparent surround", () => {
    const decoded = decodePngRgba(
      logoPng({
        width: 20,
        height: 20,
        shape: "block",
        transparentMargin: 5,
      }),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(inkBoxOf(decoded)).toEqual({
      left: 5,
      top: 5,
      width: 10,
      height: 10,
    });
  });

  it("returns null when nothing is drawn", () => {
    const decoded = decodePngRgba(
      logoPng({ width: 8, height: 8, color: [0, 0, 0, 0] }),
    );
    expect(decoded && inkBoxOf(decoded)).toBeNull();
  });
});

describe("cropRgba", () => {
  it("cuts out exactly the box it was given", () => {
    const decoded = decodePngRgba(
      logoPng({ width: 20, height: 20, shape: "block", transparentMargin: 5 }),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    const cropped = cropRgba(
      decoded,
      inkBoxOf(decoded) ?? { left: 0, top: 0, width: 1, height: 1 },
    );
    expect(cropped).toMatchObject({ width: 10, height: 10 });
    // Every pixel of the crop is the mark, so it fills its own box.
    expect(inkBoxOf(cropped)).toEqual({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
    });
  });
});

describe("regionLuminance", () => {
  const decoded = decodePngRgba(
    logoPng({ width: 16, height: 16, shape: "block", color: [0, 0, 0, 255] }),
  );

  it("reads only the region asked for", () => {
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(
      regionLuminance(decoded, { left: 0, top: 0, width: 4, height: 4 }),
    ).toBeLessThan(0.01);
  });

  /* Callers treat NaN as "leave it alone", so an empty region must not be
     reported as pitch black — that would add a backing plate nobody asked
     for. */
  it("reports NaN for a region with nothing opaque in it", () => {
    const clear = decodePngRgba(
      logoPng({ width: 16, height: 16, color: [0, 0, 0, 0] }),
    );
    expect(clear).not.toBeNull();
    if (!clear) return;
    expect(
      Number.isNaN(
        regionLuminance(clear, { left: 0, top: 0, width: 8, height: 8 }),
      ),
    ).toBe(true);
  });

  it("clamps a region that runs off the edge", () => {
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    expect(
      Number.isFinite(
        regionLuminance(decoded, {
          left: 10,
          top: 10,
          width: 500,
          height: 500,
        }),
      ),
    ).toBe(true);
  });
});

/* PNG-8 is a common logo export. Without PLTE the image decodes as index
   numbers — a near-black smear; without tRNS its transparent entries come back
   opaque and the mark arrives on a solid rectangle. */
describe("palette PNGs", () => {
  const palettePng = (withTrns: boolean) => {
    const { deflateSync } = require("node:zlib") as typeof import("node:zlib");
    const crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    const crc = (b: Buffer) => {
      let x = 0xffffffff;
      for (const byte of b) x = crcTable[(x ^ byte) & 0xff] ^ (x >>> 8);
      return (x ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "ascii");
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 3; // palette
    // Two entries: index 0 transparent, index 1 solid red.
    const plte = Buffer.from([0, 0, 0, 255, 0, 0]);
    const raw = Buffer.from([0, 0, 1]); // one row: filter 0, then indices
    const parts = [
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("PLTE", plte),
      ...(withTrns ? [chunk("tRNS", Buffer.from([0]))] : []),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ];
    return new Uint8Array(Buffer.concat(parts));
  };

  it("resolves palette entries to real colours", () => {
    const decoded = decodePngRgba(palettePng(false));
    expect(decoded).toMatchObject({ width: 2, height: 1 });
    // Second pixel is palette index 1 — solid red.
    expect(Array.from(decoded?.pixels.slice(4, 8) ?? [])).toEqual([
      255, 0, 0, 255,
    ]);
  });

  it("honours tRNS so a transparent entry stays transparent", () => {
    const decoded = decodePngRgba(palettePng(true));
    expect(decoded?.pixels[3]).toBe(0);
    expect(decoded?.pixels[7]).toBe(255);
    // And the ink box is only the opaque pixel, so cropToInk can trim it.
    expect(decoded && inkBoxOf(decoded)).toMatchObject({ left: 1, width: 1 });
  });
});

describe("readInk reports the ink's range", () => {
  const twoTone = () => {
    const width = 20;
    const height = 10;
    const pixels = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      const at = i * 4;
      // Left half near-black, right half near-white.
      const value = i % width < width / 2 ? 4 : 252;
      pixels[at] = value;
      pixels[at + 1] = value;
      pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
    return { width, height, pixels };
  };

  /* The contrast decision is built on these two numbers. A mean is the wrong
     instrument — it lands on a tone neither half of a two-tone mark has. */
  it("separates the darkest and lightest ink", () => {
    const ink = readInk(twoTone());
    expect(ink.darkest).toBeLessThan(0.01);
    expect(ink.lightest).toBeGreaterThan(0.9);
    // And the mean sits between them, matching neither.
    expect(ink.luminance).toBeGreaterThan(ink.darkest);
    expect(ink.luminance).toBeLessThan(ink.lightest);
  });

  it("collapses both onto one value for a flat mark", () => {
    const decoded = decodePngRgba(
      logoPng({
        width: 8,
        height: 8,
        shape: "block",
        color: [60, 60, 60, 255],
      }),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    const ink = readInk(decoded);
    expect(ink.darkest).toBeCloseTo(ink.lightest, 4);
  });

  /* Percentiles, not absolute extremes: one antialiased pixel must not define
     the mark. */
  it("ignores a stray pixel at each end", () => {
    const base = twoTone();
    base.pixels[0] = 128;
    base.pixels[1] = 128;
    base.pixels[2] = 128;
    const ink = readInk(base);
    expect(ink.darkest).toBeLessThan(0.01);
    expect(ink.lightest).toBeGreaterThan(0.9);
  });

  it("reports NaN for both when nothing is drawn", () => {
    const decoded = decodePngRgba(
      logoPng({ width: 8, height: 8, color: [0, 0, 0, 0] }),
    );
    expect(decoded).not.toBeNull();
    if (!decoded) return;
    const ink = readInk(decoded);
    expect(Number.isNaN(ink.darkest)).toBe(true);
    expect(Number.isNaN(ink.lightest)).toBe(true);
  });
});

/* tRNS on a non-palette image names ONE colour that means transparent. A
   greyscale or RGB logo with keyed transparency read as fully opaque, so it
   was never trimmed and its whole frame counted as ink — the mark then arrived
   sitting on a solid rectangle. */
describe("keyed transparency on greyscale and RGB", () => {
  const build = (colorType: 0 | 2, trns: number[] | null, sample: number[]) => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    const crc = (b: Buffer) => {
      let x = 0xffffffff;
      for (const byte of b) x = table[(x ^ byte) & 0xff] ^ (x >>> 8);
      return (x ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(data.length, 0);
      head.write(type, 4, "ascii");
      const tail = Buffer.alloc(4);
      tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
      return Buffer.concat([head, data, tail]);
    };
    const channels = colorType === 0 ? 1 : 3;
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = colorType;
    const raw = Buffer.from([0, ...sample.slice(0, channels)]);
    return new Uint8Array(
      Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        ...(trns ? [chunk("tRNS", Buffer.from(trns))] : []),
        chunk("IDAT", deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
      ]),
    );
  };

  it("makes a keyed greyscale pixel transparent", () => {
    // tRNS carries 16-bit samples: [high, low].
    const keyed = decodePngRgba(build(0, [0, 200], [200]));
    expect(keyed?.pixels[3]).toBe(0);
  });

  it("leaves an unkeyed greyscale pixel opaque", () => {
    expect(decodePngRgba(build(0, [0, 200], [64]))?.pixels[3]).toBe(255);
    expect(decodePngRgba(build(0, null, [200]))?.pixels[3]).toBe(255);
  });

  it("makes a keyed RGB pixel transparent", () => {
    const keyed = decodePngRgba(build(2, [0, 10, 0, 20, 0, 30], [10, 20, 30]));
    expect(keyed?.pixels[3]).toBe(0);
  });

  it("leaves an RGB pixel that only partly matches opaque", () => {
    const near = decodePngRgba(build(2, [0, 10, 0, 20, 0, 30], [10, 20, 31]));
    expect(near?.pixels[3]).toBe(255);
  });
});
