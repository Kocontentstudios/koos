import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { PNG_SIGNATURE, pngChunk } from "./image-fixtures";

/**
 * The FEAT-033 round-2 critic corpus, rebuilt in memory (no binaries in the
 * repo): valid files from libvips' own encoders, and well-framed mutations of
 * them that a structural check accepts but resvg panics on, throws on, or
 * draws as nothing. Every one is something a member can PUT to a presigned
 * design-image URL, or upload as a logo.
 *
 * Source: /tmp/feat-033/critique/upload-repro-r2/tools/gen-corpus.mjs,
 * gen-fuzz.mjs and zz-r2-png-chunks.test.ts. The Go stdlib files are not
 * rebuilt (they are not ours to regenerate); the decompression bombs are
 * scaled down, since the structural check refuses them before any decoder.
 */

export interface HostileImage {
  name: string;
  type: "png" | "jpeg";
  bytes: Buffer;
}

/* An odd size, so every chroma-subsampled and interlaced edge case has a
   partial block or a partial Adam7 pass. */
const WIDTH = 211;
const HEIGHT = 137;

/* Left half opaque, right half fading out, so alpha survives or visibly
   does not. */
function gradientRgba(): Buffer {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = (y * WIDTH + x) * 4;
      rgba[i] = (x * 255) / WIDTH;
      rgba[i + 1] = (y * 255) / HEIGHT;
      rgba[i + 2] = (x ^ y) & 0xff;
      rgba[i + 3] = x < WIDTH / 2 ? 255 : (y * 255) / HEIGHT;
    }
  }
  return rgba;
}

async function sourceImages(): Promise<Record<string, Buffer>> {
  const rgba = gradientRgba();
  const img = () =>
    sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } });
  const opaque = () => img().flatten({ background: "#ffffff" });
  const transparentPixel = () =>
    sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });
  const entries: [string, Promise<Buffer>][] = [
    ["s-rgba8.png", img().png().toBuffer()],
    ["s-rgba8-interlaced.png", img().png({ progressive: true }).toBuffer()],
    ["s-rgba16.png", img().toColourspace("rgb16").png().toBuffer()],
    [
      "s-rgba16-interlaced.png",
      img().toColourspace("rgb16").png({ progressive: true }).toBuffer(),
    ],
    ["s-rgb8.png", opaque().png().toBuffer()],
    ["s-rgb16.png", opaque().toColourspace("rgb16").png().toBuffer()],
    ["s-palette8.png", img().png({ palette: true, colours: 200 }).toBuffer()],
    [
      "s-palette8-interlaced.png",
      img().png({ palette: true, colours: 200, progressive: true }).toBuffer(),
    ],
    ["s-palette4.png", opaque().png({ palette: true, colours: 16 }).toBuffer()],
    ["s-palette2.png", opaque().png({ palette: true, colours: 4 }).toBuffer()],
    ["s-palette1.png", opaque().png({ palette: true, colours: 2 }).toBuffer()],
    [
      "s-palette1-interlaced.png",
      opaque().png({ palette: true, colours: 2, progressive: true }).toBuffer(),
    ],
    ["s-gray8.png", opaque().toColourspace("b-w").png().toBuffer()],
    ["s-gray16.png", opaque().toColourspace("grey16").png().toBuffer()],
    ["s-grayalpha8.png", img().toColourspace("b-w").png().toBuffer()],
    [
      "s-grayalpha8-interlaced.png",
      img().toColourspace("b-w").png({ progressive: true }).toBuffer(),
    ],
    ["s-grayalpha16.png", img().toColourspace("grey16").png().toBuffer()],
    ["s-1x1-transparent.png", transparentPixel().png().toBuffer()],
    [
      "s-1x1-transparent-interlaced.png",
      transparentPixel().png({ progressive: true }).toBuffer(),
    ],
    [
      "s-3x2-interlaced.png",
      sharp({
        create: { width: 3, height: 2, channels: 3, background: "#123456" },
      })
        .png({ progressive: true })
        .toBuffer(),
    ],
    ["s-baseline.jpg", opaque().jpeg({ quality: 90 }).toBuffer()],
    [
      "s-progressive.jpg",
      opaque().jpeg({ quality: 90, progressive: true }).toBuffer(),
    ],
    ["s-mozjpeg.jpg", opaque().jpeg({ mozjpeg: true }).toBuffer()],
    ["s-gray.jpg", opaque().toColourspace("b-w").jpeg().toBuffer()],
    ["s-cmyk.jpg", opaque().toColourspace("cmyk").jpeg().toBuffer()],
    ["s-444.jpg", opaque().jpeg({ chromaSubsampling: "4:4:4" }).toBuffer()],
    [
      "s-exif-orient6.jpg",
      opaque().withMetadata({ orientation: 6 }).jpeg().toBuffer(),
    ],
  ];
  const built = await Promise.all(entries.map(([, bytes]) => bytes));
  return Object.fromEntries(entries.map(([name], i) => [name, built[i]]));
}

function ihdr(width: number, height: number, depth = 8, colour = 6) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = depth;
  data[9] = colour;
  return pngChunk("IHDR", data);
}

const IEND = pngChunk("IEND");

function scanlines(
  width: number,
  height: number,
  bytesPerPixel: number,
  { filter = 0, sample = 0x80 } = {},
): Buffer {
  const row = Buffer.concat([
    Buffer.from([filter]),
    Buffer.alloc(width * bytesPerPixel, sample),
  ]);
  return Buffer.concat(Array.from({ length: height }, () => row));
}

const png = (...chunks: Buffer[]) => Buffer.concat([PNG_SIGNATURE, ...chunks]);

/* Truncations, trailing junk, damaged entropy data, and hand-built PNGs that
   break one decoder rule each. */
function mutations(sources: Record<string, Buffer>): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const base of [
    "s-rgba8.png",
    "s-baseline.jpg",
    "s-progressive.jpg",
    "s-rgba8-interlaced.png",
    "s-palette8.png",
  ]) {
    const whole = sources[base];
    for (const fraction of [0.25, 0.5, 0.9]) {
      out[`m-trunc${fraction}-${base}`] = whole.subarray(
        0,
        Math.floor(whole.length * fraction),
      );
    }
    out[`m-trunc-minus1-${base}`] = whole.subarray(0, whole.length - 1);
    out[`m-trunc-minus2-${base}`] = whole.subarray(0, whole.length - 2);
    out[`m-trailing-junk-${base}`] = Buffer.concat([
      whole,
      Buffer.from("<html><script>alert(1)</script></html>"),
    ]);
  }

  for (const base of ["s-baseline.jpg", "s-progressive.jpg", "s-444.jpg"]) {
    const whole = sources[base];
    const sos = whole.indexOf(Buffer.from([0xff, 0xda]), 2);
    const scanStart = sos + 2 + whole.readUInt16BE(sos + 2);
    let seed = 7;
    const nextByte = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % 0xfe;
    };
    const garbage = Buffer.from(whole);
    const garbageEnd =
      scanStart + Math.min(4000, (whole.length - scanStart) >> 1);
    for (let i = scanStart; i < garbageEnd; i += 1) {
      if (garbage[i] !== 0xff && garbage[i - 1] !== 0xff) {
        garbage[i] = nextByte();
      }
    }
    out[`m-entropy-garbage-${base}`] = garbage;
    const zeroed = Buffer.from(whole);
    zeroed.fill(0, scanStart, whole.length - 2);
    out[`m-entropy-zeroed-${base}`] = zeroed;
    out[`m-empty-scan-${base}`] = Buffer.concat([
      whole.subarray(0, scanStart),
      Buffer.from([0xff, 0xd9]),
    ]);
  }

  const rgbaIdat = () => pngChunk("IDAT", deflateSync(scanlines(16, 16, 4)));
  const split = deflateSync(scanlines(16, 16, 4));
  Object.assign(out, {
    "m-filter5.png": png(
      ihdr(16, 16),
      pngChunk("IDAT", deflateSync(scanlines(16, 16, 4, { filter: 5 }))),
      IEND,
    ),
    "m-good-handmade.png": png(ihdr(16, 16), rgbaIdat(), IEND),
    "m-short-idat.png": png(
      ihdr(16, 16),
      pngChunk("IDAT", deflateSync(scanlines(16, 15, 4))),
      IEND,
    ),
    "m-long-idat.png": png(
      ihdr(16, 16),
      pngChunk("IDAT", deflateSync(scanlines(16, 17, 4))),
      IEND,
    ),
    "m-zlib-trailing.png": png(
      ihdr(16, 16),
      pngChunk(
        "IDAT",
        Buffer.concat([
          deflateSync(scanlines(16, 16, 4)),
          Buffer.from("garbagegarbage"),
        ]),
      ),
      IEND,
    ),
    "m-split-idat-gap.png": png(
      ihdr(16, 16),
      pngChunk("IDAT", split.subarray(0, 10)),
      pngChunk("tEXt", Buffer.from("k\0v")),
      pngChunk("IDAT", split.subarray(10)),
      IEND,
    ),
    "m-palette-index-oob.png": png(
      ihdr(4, 4, 8, 3),
      pngChunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0])),
      pngChunk(
        "IDAT",
        deflateSync(
          Buffer.concat(
            Array.from({ length: 4 }, () => Buffer.from([0, 0, 1, 7, 200])),
          ),
        ),
      ),
      IEND,
    ),
    "m-palette-missing.png": png(
      ihdr(4, 4, 8, 3),
      pngChunk("IDAT", deflateSync(scanlines(4, 4, 1))),
      IEND,
    ),
    "m-idat-before-plte.png": png(
      ihdr(4, 4, 8, 3),
      pngChunk("IDAT", deflateSync(scanlines(4, 4, 1))),
      pngChunk("PLTE", Buffer.from([255, 0, 0])),
      IEND,
    ),
    "m-bad-ancillary-crc.png": (() => {
      const text = pngChunk("tEXt", Buffer.from("Comment\0hi"));
      text[text.length - 1] ^= 0xff;
      return png(ihdr(16, 16), text, rgbaIdat(), IEND);
    })(),
    "m-unknown-critical-chunk.png": png(
      ihdr(16, 16),
      pngChunk("ABCD", Buffer.from("x")),
      rgbaIdat(),
      IEND,
    ),
    "m-no-iend.png": png(ihdr(16, 16), rgbaIdat()),
    "m-header-only.png": png(ihdr(16, 16)),
    "m-bomb-overflow-100x100.png": png(
      ihdr(100, 100),
      pngChunk("IDAT", deflateSync(Buffer.alloc(16 * 1024 * 1024))),
      IEND,
    ),
    /* The worst file the caps allow: 128 MB of inflated scanlines, every
       pixel transparent. */
    "m-max-4096-rgba16-transparent.png": png(
      ihdr(4096, 4096, 16, 6),
      pngChunk(
        "IDAT",
        deflateSync(Buffer.alloc((1 + 4096 * 8) * 4096), { level: 9 }),
      ),
      IEND,
    ),
  });
  return out;
}

/* One chunk-level rule broken per file, each with every CRC valid. */
function chunkCases(): Record<string, Buffer> {
  const rows = (bpp: number, sample: number) =>
    deflateSync(scanlines(16, 16, bpp, { sample }));
  const rgba = (...extra: Buffer[]) =>
    png(ihdr(16, 16), ...extra, pngChunk("IDAT", rows(4, 0xc0)), IEND);
  const rgb = (...extra: Buffer[]) =>
    png(ihdr(16, 16, 8, 2), ...extra, pngChunk("IDAT", rows(3, 0x40)), IEND);
  const palette = (plte: Buffer, ...extra: Buffer[]) =>
    png(
      ihdr(16, 16, 8, 3),
      pngChunk("PLTE", plte),
      ...extra,
      pngChunk("IDAT", rows(1, 0)),
      IEND,
    );
  const split = rows(4, 0xc0);
  const cases: Record<string, Buffer> = {
    control_rgba: rgba(),
    control_rgb: rgb(),
    control_palette: palette(Buffer.from([0, 0, 255])),
    unknown_critical_ABCD: rgba(pngChunk("ABCD", Buffer.from("x"))),
    unknown_critical_after_idat: png(
      ihdr(16, 16),
      pngChunk("IDAT", rows(4, 0xc0)),
      pngChunk("ZZZZ"),
      IEND,
    ),
    idat_split_by_text: png(
      ihdr(16, 16),
      pngChunk("IDAT", split.subarray(0, 10)),
      pngChunk("tEXt", Buffer.from("k\0v")),
      pngChunk("IDAT", split.subarray(10)),
      IEND,
    ),
    trns_wrong_len_rgb: rgb(pngChunk("tRNS", Buffer.from([0, 1]))),
    trns_on_rgba_forbidden: rgba(
      pngChunk("tRNS", Buffer.from([0, 1, 0, 1, 0, 1])),
    ),
    trns_longer_than_palette: palette(
      Buffer.from([0, 0, 255]),
      pngChunk("tRNS", Buffer.from([1, 2, 3])),
    ),
    plte_len_not_mult3: palette(Buffer.from([0, 0, 255, 9])),
    plte_300_entries: palette(Buffer.alloc(900, 7)),
    plte_twice: palette(
      Buffer.from([0, 0, 255]),
      pngChunk("PLTE", Buffer.from([0, 255, 0])),
    ),
    plte_after_idat_rgb: png(
      ihdr(16, 16, 8, 2),
      pngChunk("IDAT", rows(3, 0x40)),
      pngChunk("PLTE", Buffer.from([1, 2, 3])),
      IEND,
    ),
    plte_on_gray_forbidden: png(
      ihdr(16, 16, 8, 0),
      pngChunk("PLTE", Buffer.from([1, 2, 3])),
      pngChunk("IDAT", rows(1, 0x40)),
      IEND,
    ),
    iccp_garbage: rgba(
      pngChunk("iCCP", Buffer.from("p\0\0not zlib at all", "latin1")),
    ),
    srgb_wrong_len: rgba(pngChunk("sRGB", Buffer.from([0, 0, 0]))),
    gama_zero: rgba(pngChunk("gAMA", Buffer.alloc(4))),
    gama_wrong_len: rgba(pngChunk("gAMA", Buffer.alloc(1))),
    phys_wrong_len: rgba(pngChunk("pHYs", Buffer.alloc(2))),
    actl_bogus: rgba(pngChunk("acTL", Buffer.alloc(8))),
    fctl_bogus: rgba(
      pngChunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])),
      pngChunk("fcTL", Buffer.alloc(26, 0xff)),
    ),
    two_ihdr: png(
      ihdr(16, 16),
      ihdr(16, 16),
      pngChunk("IDAT", rows(4, 0xc0)),
      IEND,
    ),
    idat_zero_len_extra: png(
      ihdr(16, 16),
      pngChunk("IDAT", rows(4, 0xc0)),
      pngChunk("IDAT"),
      IEND,
    ),
    data_after_iend: Buffer.concat([rgba(), Buffer.from("trailing")]),
    iend_with_data: png(
      ihdr(16, 16),
      pngChunk("IDAT", rows(4, 0xc0)),
      pngChunk("IEND", Buffer.from("x")),
    ),
  };
  return Object.fromEntries(
    Object.entries(cases).map(([name, bytes]) => [`c-${name}.png`, bytes]),
  );
}

interface Marker {
  marker: number;
  at: number;
  length: number;
}

function jpegMarkers(bytes: Buffer): Marker[] {
  const found: Marker[] = [];
  let at = 2;
  while (at < bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xd9) break;
    const length = bytes.readUInt16BE(at + 2);
    found.push({ marker, at, length });
    if (marker === 0xda) break;
    at += 2 + length;
  }
  return found;
}

function withoutSegments(bytes: Buffer, marker: number): Buffer {
  let out = bytes;
  const segments = jpegMarkers(bytes).filter((m) => m.marker === marker);
  for (const segment of segments.reverse()) {
    out = Buffer.concat([
      out.subarray(0, segment.at),
      out.subarray(segment.at + 2 + segment.length),
    ]);
  }
  return out;
}

/* Every marker still well framed; one field in one segment is wrong. */
function jpegFuzz(sources: Record<string, Buffer>): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [tag, whole] of [
    ["base", sources["s-baseline.jpg"]],
    ["prog", sources["s-progressive.jpg"]],
  ] as const) {
    const markers = jpegMarkers(whole);
    const find = (marker: number) => {
      const segment = markers.find((m) => m.marker === marker);
      if (!segment) throw new Error(`no marker ${marker.toString(16)}`);
      return segment;
    };
    const sof = markers.find((m) => m.marker === 0xc0 || m.marker === 0xc2);
    if (!sof) throw new Error("no frame header");
    const sos = find(0xda);
    const dqt = find(0xdb);
    const dht = find(0xc4);
    const mutate = (name: string, change: (copy: Buffer) => void) => {
      const copy = Buffer.from(whole);
      change(copy);
      out[`j-${tag}-${name}.jpg`] = copy;
    };
    const firstComponent = sof.at + 4 + 6;
    const scanComponents = whole[sos.at + 4];

    mutate("sof-precision12", (c) => {
      c[sof.at + 4] = 12;
    });
    mutate("sof-precision16", (c) => {
      c[sof.at + 4] = 16;
    });
    mutate("sof-sampling0", (c) => {
      c[firstComponent + 1] = 0x00;
    });
    mutate("sof-sampling-ff", (c) => {
      c[firstComponent + 1] = 0xff;
    });
    mutate("sof-sampling-31", (c) => {
      c[firstComponent + 1] = 0x31;
    });
    mutate("sof-qtable-9", (c) => {
      c[firstComponent + 2] = 9;
    });
    mutate("sof-qtable-3-missing", (c) => {
      c[firstComponent + 2] = 3;
    });
    mutate("sof-marker-c3-lossless", (c) => {
      c[sof.at + 1] = 0xc3;
    });
    mutate("sof-marker-c9-arith", (c) => {
      c[sof.at + 1] = 0xc9;
    });
    mutate("sof-marker-c1", (c) => {
      c[sof.at + 1] = 0xc1;
    });
    mutate("sof-4096x4096-small-data", (c) => {
      c.writeUInt16BE(4096, sof.at + 5);
      c.writeUInt16BE(4096, sof.at + 7);
    });
    mutate("sos-component-id-99", (c) => {
      c[sos.at + 5] = 99;
    });
    mutate("sos-huff-table-3", (c) => {
      c[sos.at + 6] = 0x33;
    });
    mutate("sos-huff-table-ff", (c) => {
      c[sos.at + 6] = 0xff;
    });
    mutate("sos-ss-se-bogus", (c) => {
      c[sos.at + 5 + 2 * scanComponents] = 63;
      c[sos.at + 6 + 2 * scanComponents] = 0;
    });
    mutate("sos-ah-al-15", (c) => {
      c[sos.at + 7 + 2 * scanComponents] = 0xff;
    });
    mutate("dqt-precision16", (c) => {
      c[dqt.at + 4] |= 0x10;
    });
    mutate("dqt-zeros", (c) => {
      c.fill(0, dqt.at + 5, dqt.at + 2 + dqt.length);
    });
    mutate("dht-counts-ff", (c) => {
      c.fill(0xfe, dht.at + 5, dht.at + 21);
    });
    mutate("dht-counts-zero", (c) => {
      c.fill(0, dht.at + 5, dht.at + 21);
    });
    mutate("dht-class-7", (c) => {
      c[dht.at + 4] = 0x77;
    });
    out[`j-${tag}-no-dht.jpg`] = withoutSegments(whole, 0xc4);
    out[`j-${tag}-no-dqt.jpg`] = withoutSegments(whole, 0xdb);
    out[`j-${tag}-dri1-no-rst.jpg`] = Buffer.concat([
      whole.subarray(0, sof.at),
      Buffer.from([0xff, 0xdd, 0, 4, 0, 1]),
      whole.subarray(sof.at),
    ]);
    out[`j-${tag}-app1-64k.jpg`] = Buffer.concat([
      whole.subarray(0, 2),
      Buffer.from([0xff, 0xe1, 0xff, 0xff]),
      Buffer.alloc(0xfffd, 0x41),
      whole.subarray(2),
    ]);
  }
  return out;
}

interface Chunk {
  type: string;
  data: Buffer;
}

function pngChunks(bytes: Buffer): Chunk[] {
  const chunks: Chunk[] = [];
  let at = PNG_SIGNATURE.length;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    chunks.push({
      type: bytes.toString("latin1", at + 4, at + 8),
      data: bytes.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

const rebuild = (chunks: Chunk[]) =>
  png(...chunks.map(({ type, data }) => pngChunk(type, data)));

/* The PLTE-length cases are the ones that abort resvg: a palette of 4, 5, 7
   or 8 bytes panics it inside next/og with SIGABRT. */
function paletteFuzz(sources: Record<string, Buffer>): Record<string, Buffer> {
  const withPalette = (base: Buffer, data: Buffer) =>
    rebuild(
      pngChunks(base).map((c) => (c.type === "PLTE" ? { ...c, data } : c)),
    );
  const withTransparency = (base: Buffer, data: Buffer) => {
    const chunks = pngChunks(base).filter((c) => c.type !== "tRNS");
    chunks.splice(
      chunks.findIndex((c) => c.type === "IDAT"),
      0,
      { type: "tRNS", data },
    );
    return rebuild(chunks);
  };
  const palette8 = sources["s-palette8.png"];
  const out: Record<string, Buffer> = {};
  for (const length of [0, 1, 2, 4, 5, 7, 8, 769]) {
    out[`p-pal8-plte-len${length}.png`] = withPalette(
      palette8,
      Buffer.alloc(length, 9),
    );
  }
  out["p-pal1-plte-1entry-but-index1-used.png"] = withPalette(
    sources["s-palette1.png"],
    Buffer.from([1, 2, 3]),
  );
  out["p-pal8-plte-3entries.png"] = withPalette(palette8, Buffer.alloc(9, 9));
  for (const length of [0, 1, 300]) {
    out[`p-pal8-trns-len${length}.png`] = withTransparency(
      palette8,
      Buffer.alloc(length, 7),
    );
  }
  return out;
}

let built: Promise<HostileImage[]> | undefined;

/** Built once per test file: the 4096 px fixture alone deflates 128 MB. */
export function hostileImageCorpus(): Promise<HostileImage[]> {
  built ??= buildCorpus();
  return built;
}

async function buildCorpus(): Promise<HostileImage[]> {
  const sources = await sourceImages();
  const all = {
    ...sources,
    ...mutations(sources),
    ...chunkCases(),
    ...jpegFuzz(sources),
    ...paletteFuzz(sources),
  };
  return Object.entries(all).map(([name, bytes]) => ({
    name,
    type: name.endsWith(".png") ? "png" : "jpeg",
    bytes,
  }));
}
