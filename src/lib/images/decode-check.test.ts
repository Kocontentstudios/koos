// @vitest-environment node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  inflatedPngSize,
  inflatesToLayout,
  jpegDecodes,
  jpegHasUndrawableFrame,
  type PngHeader,
  pngDecodes,
  pngScanlineLayout,
  readPngStructure,
} from "./decode-check";
import {
  buildJpeg,
  buildPng,
  ihdrChunk,
  joinJpeg,
  jpegParts,
  PNG_SIGNATURE,
  pngChunk,
  rawScanlines,
} from "./image-fixtures";

const COMBINATIONS: [colourType: number, bitDepth: number][] = [
  [0, 1],
  [0, 2],
  [0, 4],
  [0, 8],
  [0, 16],
  [2, 8],
  [2, 16],
  [3, 1],
  [3, 2],
  [3, 4],
  [3, 8],
  [4, 8],
  [4, 16],
  [6, 8],
  [6, 16],
];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/* An independent count, pixel by pixel, of which Adam7 pass each pixel lands
   in, so the layout is checked against the definition rather than against a
   second copy of the same arithmetic. */
function bruteForceInflatedSize(header: PngHeader): number {
  const bitsPerPixel = CHANNELS[header.colourType] * header.bitDepth;
  const rowBytes = (pixels: number) =>
    1 + Math.ceil((pixels * bitsPerPixel) / 8);
  if (!header.interlaced) return header.height * rowBytes(header.width);
  const PASS_OF = [
    [1, 6, 4, 6, 2, 6, 4, 6],
    [7, 7, 7, 7, 7, 7, 7, 7],
    [5, 6, 5, 6, 5, 6, 5, 6],
    [7, 7, 7, 7, 7, 7, 7, 7],
    [3, 6, 4, 6, 3, 6, 4, 6],
    [7, 7, 7, 7, 7, 7, 7, 7],
    [5, 6, 5, 6, 5, 6, 5, 6],
    [7, 7, 7, 7, 7, 7, 7, 7],
  ];
  let total = 0;
  for (let pass = 1; pass <= 7; pass += 1) {
    const rows = new Map<number, number>();
    for (let y = 0; y < header.height; y += 1) {
      for (let x = 0; x < header.width; x += 1) {
        if (PASS_OF[y % 8][x % 8] === pass) rows.set(y, (rows.get(y) ?? 0) + 1);
      }
    }
    for (const pixels of rows.values()) total += rowBytes(pixels);
  }
  return total;
}

describe("pngScanlineLayout", () => {
  const SIZES = [
    [1, 1],
    [2, 1],
    [1, 9],
    [3, 3],
    [5, 7],
    [8, 8],
    [9, 9],
    [13, 11],
    [33, 17],
  ];

  it.each(COMBINATIONS)(
    "matches a pixel-by-pixel count for colour type %i at %i bits",
    (colourType, bitDepth) => {
      for (const [width, height] of SIZES) {
        for (const interlaced of [false, true]) {
          const header = { width, height, colourType, bitDepth, interlaced };
          expect(inflatedPngSize(header), JSON.stringify(header)).toBe(
            bruteForceInflatedSize(header),
          );
        }
      }
    },
  );

  /* A 1x1 interlaced image has only pass 1; the six empty passes carry no
     filter byte. Counting them would demand bytes a real encoder never
     writes, and refuse every tiny interlaced image. */
  it("gives an empty pass no filter byte", () => {
    expect(
      pngScanlineLayout({
        width: 1,
        height: 1,
        bitDepth: 8,
        colourType: 6,
        interlaced: true,
      }),
    ).toEqual([{ bytes: 5, count: 1 }]);
  });
});

describe("pngDecodes", () => {
  it.each(COMBINATIONS)(
    "accepts colour type %i at %i bits, plain and interlaced",
    async (colourType, bitDepth) => {
      for (const interlaced of [false, true]) {
        for (const [width, height] of [
          [1, 1],
          [13, 11],
          [64, 3],
        ]) {
          const png = buildPng(width, height, {
            colourType,
            bitDepth,
            interlaced,
          });
          expect(
            await pngDecodes(png),
            `${width}x${height} ${interlaced}`,
          ).toBe(true);
        }
      }
    },
  );

  const header: PngHeader = {
    width: 16,
    height: 8,
    bitDepth: 8,
    colourType: 2,
    interlaced: false,
  };
  const withIdat = (idat: Uint8Array, extra: Buffer[] = []) =>
    Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk(header),
      ...extra,
      pngChunk("IDAT", idat),
      pngChunk("IEND"),
    ]);

  it("refuses a chunk whose CRC does not match", async () => {
    const png = buildPng(16, 8, { colourType: 2 });
    const idatCrc = png.length - 12 - 1;
    png[idatCrc] ^= 0xff;
    expect(await pngDecodes(png)).toBe(false);
  });

  it("refuses a scanline with an unknown filter type", async () => {
    const raw = rawScanlines(header);
    raw[(1 + 16 * 3) * 3] = 5;
    expect(await pngDecodes(withIdat(deflateSync(raw)))).toBe(false);
  });

  it("refuses an IDAT stream longer than the header promises", async () => {
    const raw = Buffer.concat([rawScanlines(header), Buffer.alloc(1)]);
    expect(await pngDecodes(withIdat(deflateSync(raw)))).toBe(false);
  });

  it("refuses an IDAT stream shorter than the header promises", async () => {
    const raw = rawScanlines(header).subarray(1);
    expect(await pngDecodes(withIdat(deflateSync(raw)))).toBe(false);
  });

  it("refuses a zlib stream cut short", async () => {
    const stream = deflateSync(rawScanlines(header));
    expect(await pngDecodes(withIdat(stream.subarray(0, -4)))).toBe(false);
  });

  /* Decoders stop at the end of the zlib stream; padding after it in the last
     IDAT is harmless, and refusing it would refuse images that draw. */
  it("accepts bytes after the end of the zlib stream", async () => {
    const stream = deflateSync(rawScanlines(header));
    const padded = Buffer.concat([stream, Buffer.alloc(8)]);
    expect(await pngDecodes(withIdat(padded))).toBe(true);
  });

  it("refuses a palette image with no palette before its pixels", async () => {
    const paletted = { ...header, colourType: 3 };
    const png = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk(paletted),
      pngChunk("IDAT", deflateSync(rawScanlines(paletted))),
      pngChunk("IEND"),
    ]);
    expect(await pngDecodes(png)).toBe(false);
  });

  it.each([
    ["bit depth 3", { bitDepth: 3, colourType: 0 }],
    ["16-bit palette", { bitDepth: 16, colourType: 3 }],
    ["4-bit RGB", { bitDepth: 4, colourType: 2 }],
    ["colour type 5", { bitDepth: 8, colourType: 5 }],
    ["zero width", { width: 0 }],
  ])("refuses an IHDR with %s", (_label, fields) => {
    const png = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk({ ...header, ...fields }),
      pngChunk("IDAT", deflateSync(Buffer.alloc(8))),
      pngChunk("IEND"),
    ]);
    expect(readPngStructure(png)).toBeNull();
  });

  it("refuses a file whose first chunk is not IHDR", async () => {
    const png = Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("tEXt", Buffer.from("Comment\0hi")),
      ihdrChunk(header),
      pngChunk("IDAT", deflateSync(rawScanlines(header))),
      pngChunk("IEND"),
    ]);
    expect(await pngDecodes(png)).toBe(false);
  });

  it("refuses a file with no IDAT", async () => {
    const png = Buffer.concat([
      PNG_SIGNATURE,
      ihdrChunk(header),
      pngChunk("IEND"),
    ]);
    expect(await pngDecodes(png)).toBe(false);
  });

  it("refuses a chunk type that is not four letters", async () => {
    const png = withIdat(deflateSync(rawScanlines(header)), [
      pngChunk("t3Xt", Buffer.from("x")),
    ]);
    expect(await pngDecodes(png)).toBe(false);
  });

  it("ignores what follows IEND", async () => {
    const png = Buffer.concat([buildPng(4, 4), Buffer.from("trailer")]);
    expect(await pngDecodes(png)).toBe(true);
  });
});

describe("inflatesToLayout", () => {
  /* The bound is the header's promise, not a fixed ceiling, so a tiny image
     with a huge stream is refused after one window of output. */
  it("stops a stream that outruns a 1x1 promise", async () => {
    const bomb = deflateSync(Buffer.alloc(32 * 1024 * 1024));
    const layout = [{ bytes: 2, count: 1 }];
    expect(await inflatesToLayout(bomb, layout)).toBe(false);
  });

  it("accepts a stream that ends exactly on the promise", async () => {
    const layout = [
      { bytes: 3, count: 2 },
      { bytes: 5, count: 1 },
    ];
    expect(await inflatesToLayout(deflateSync(Buffer.alloc(11)), layout)).toBe(
      true,
    );
  });

  it("checks the filter byte at every run boundary", async () => {
    const layout = [
      { bytes: 3, count: 2 },
      { bytes: 5, count: 1 },
    ];
    const raw = Buffer.alloc(11);
    raw[6] = 9;
    expect(await inflatesToLayout(deflateSync(raw), layout)).toBe(false);
    raw[6] = 0;
    raw[7] = 9;
    expect(await inflatesToLayout(deflateSync(raw), layout)).toBe(true);
  });
});

describe("jpegDecodes", () => {
  it("accepts the built baseline JPEG at several sizes", () => {
    for (const [w, h] of [
      [1, 1],
      [8, 8],
      [9, 17],
      [640, 480],
    ]) {
      expect(jpegDecodes(buildJpeg(w, h)), `${w}x${h}`).toBe(true);
    }
  });

  it("refuses a file with no frame header", () => {
    expect(jpegDecodes(joinJpeg({ ...jpegParts(8, 8), frame: [] }))).toBe(
      false,
    );
  });

  it("refuses a scan before the frame header", () => {
    const parts = jpegParts(8, 8);
    const scanFirst = joinJpeg({
      soi: parts.soi,
      tables: parts.tables,
      scanHeader: parts.scanHeader,
      scan: [...parts.scan, ...parts.frame],
      eoi: parts.eoi,
    });
    expect(jpegDecodes(scanFirst)).toBe(false);
  });

  it("refuses a file with no scan", () => {
    expect(
      jpegDecodes(joinJpeg({ ...jpegParts(8, 8), scanHeader: [], scan: [] })),
    ).toBe(false);
  });

  it("refuses a file with no end marker", () => {
    expect(jpegDecodes(joinJpeg({ ...jpegParts(8, 8), eoi: [] }))).toBe(false);
  });

  it("refuses a segment that runs past the end of the file", () => {
    const parts = jpegParts(8, 8);
    const frame = [...parts.frame];
    frame[3] = 0xff;
    expect(jpegDecodes(joinJpeg({ ...parts, frame }))).toBe(false);
  });

  it("refuses a frame header whose length disagrees with its components", () => {
    const parts = jpegParts(8, 8);
    const frame = [...parts.frame];
    frame[9] = 3;
    expect(jpegDecodes(joinJpeg({ ...parts, frame }))).toBe(false);
  });

  it("refuses bytes between segments that are not a marker", () => {
    const parts = jpegParts(8, 8);
    expect(
      jpegDecodes(joinJpeg({ ...parts, app0: [...parts.app0, 0x42] })),
    ).toBe(false);
  });

  /* Stuffed FF 00 and restart markers belong to the scan; an end marker
     hidden behind them would otherwise be found early or not at all. */
  it("reads through stuffed bytes and restart markers in a scan", () => {
    const parts = jpegParts(8, 8);
    const scan = [0x00, 0xff, 0x00, 0xff, 0xd0, 0x00, 0x3f];
    expect(jpegDecodes(joinJpeg({ ...parts, scan }))).toBe(true);
    expect(
      jpegDecodes(joinJpeg({ ...parts, scan: [0xff, 0x00], eoi: [0xff] })),
    ).toBe(false);
  });

  it("accepts fill bytes before a marker and data after the end marker", () => {
    const parts = jpegParts(8, 8);
    const filled = joinJpeg({ ...parts, frame: [0xff, 0xff, ...parts.frame] });
    expect(jpegDecodes(filled)).toBe(true);
    expect(
      jpegDecodes(Buffer.concat([buildJpeg(8, 8), Buffer.from("x")])),
    ).toBe(true);
  });

  it("refuses a second start-of-image marker", () => {
    const parts = jpegParts(8, 8);
    expect(jpegDecodes(joinJpeg({ ...parts, app0: [0xff, 0xd8] }))).toBe(false);
  });

  it("refuses a second frame header", () => {
    const parts = jpegParts(8, 8);
    const frame = [...parts.frame, ...parts.frame];
    expect(jpegDecodes(joinJpeg({ ...parts, frame }))).toBe(false);
  });
});

/* Round-4 critic C3: an arithmetic-coded frame marker over Huffman data
   decoded as noise with no warning, and was drawn. */
describe("JPEG frame types", () => {
  const withFrame = (marker: number) => {
    const parts = jpegParts(8, 8);
    return joinJpeg({
      ...parts,
      frame: [0xff, marker, ...parts.frame.slice(2)],
    });
  };
  const DRAWABLE = [0xc0, 0xc1, 0xc2];
  const LOSSLESS_HIERARCHICAL = [0xc3, 0xc5, 0xc6, 0xc7];
  const ARITHMETIC = [0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf];
  const hex = (m: number) => m.toString(16);

  it.each(DRAWABLE.map(hex))("allows Huffman frame %s", (marker) => {
    const bytes = withFrame(Number.parseInt(marker, 16));
    expect(jpegHasUndrawableFrame(bytes)).toBe(false);
    expect(jpegDecodes(bytes)).toBe(true);
  });

  it.each([...LOSSLESS_HIERARCHICAL, ...ARITHMETIC].map(hex))(
    "refuses frame %s",
    (marker) => {
      const bytes = withFrame(Number.parseInt(marker, 16));
      expect(jpegHasUndrawableFrame(bytes)).toBe(true);
      expect(jpegDecodes(bytes)).toBe(false);
    },
  );

  /* DHT (C4), JPG (C8) and DAC (CC) share the range but are not frames. */
  it("reads past table segments in the frame range to the frame", () => {
    const parts = jpegParts(8, 8);
    const dac = [0xff, 0xcc, 0x00, 0x04, 0x00, 0x10];
    const bytes = joinJpeg({ ...parts, tables: [...parts.tables, ...dac] });
    expect(jpegHasUndrawableFrame(bytes)).toBe(false);
    expect(jpegHasUndrawableFrame(withFrame(0xc9))).toBe(true);
  });

  it("leaves a file it cannot walk to the decoder", () => {
    expect(jpegHasUndrawableFrame(Buffer.from("not a jpeg"))).toBe(false);
    expect(jpegHasUndrawableFrame(buildJpeg(8, 8).subarray(0, 4))).toBe(false);
    expect(
      jpegHasUndrawableFrame(joinJpeg({ ...jpegParts(8, 8), frame: [] })),
    ).toBe(false);
  });
});

/* Real encoders' output, local only (no binaries in the repo). Go's image
   tests ship PngSuite and its own decoder's invalid-input cases; GOROOT_SRC
   overrides where they are looked for. */
const goSrc =
  process.env.GOROOT_SRC ?? join(process.env.HOME ?? "", ".local/go/src");
const pngTestdata = join(goSrc, "image/png/testdata");
const listPngs = (dir: string) =>
  existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".png")) : [];

describe("Go's PNG test corpus", () => {
  const suite = listPngs(join(pngTestdata, "pngsuite"));
  const valid = listPngs(pngTestdata).filter((n) => !n.startsWith("invalid-"));

  it.skipIf(suite.length === 0)("accepts all of PngSuite", async () => {
    const refused: string[] = [];
    for (const name of suite) {
      const bytes = readFileSync(join(pngTestdata, "pngsuite", name));
      if (!(await pngDecodes(bytes))) refused.push(name);
    }
    expect(refused).toEqual([]);
  });

  it.skipIf(valid.length === 0)(
    "accepts Go's own fixtures, interlaced ones included",
    async () => {
      const refused: string[] = [];
      for (const name of valid) {
        const bytes = readFileSync(join(pngTestdata, name));
        if (!(await pngDecodes(bytes))) refused.push(name);
      }
      expect(valid).toContain("benchRGB-interlace.png");
      expect(refused).toEqual([]);
    },
  );

  it
    .skipIf(valid.length === 0)
    .each([
      "invalid-crc32.png",
      "invalid-noend.png",
      "invalid-trunc.png",
      "invalid-zlib.png",
    ])("refuses %s", async (name) => {
    expect(await pngDecodes(readFileSync(join(pngTestdata, name)))).toBe(false);
  });
});
