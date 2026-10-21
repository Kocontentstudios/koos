import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { ihdrChunk, PNG_SIGNATURE, pngChunk } from "./image-fixtures";

/**
 * Images at the size limits, built in memory (no binaries in the repo), for
 * the FEAT-033 round-3 critic's B7: the renderer refuses an image over
 * 7,499,820 bytes, and nothing bounded the size of a re-encode.
 *
 * Source: /tmp/feat-033/critique/upload-repro-r3/tools/gen-real.mjs and
 * gen-png-r3.mjs / gen-jpg-r3.py ("huge-4096-*").
 */

/* Deterministic, so a failure reproduces byte for byte. */
function randomBytes(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed;
  for (let i = 0; i < length; i += 1) {
    state = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff;
    out[i] = state >>> 23;
  }
  return out;
}

/**
 * A photograph-like cutout: smooth colour texture over gradients, with a
 * little sensor grain and a circular alpha mask, the shape of a product photo
 * the browser normaliser sends as PNG. Written filtered, as a browser writes
 * it, it is about 11 MB, inside the 20 MB cap; re-encoded unfiltered, as
 * round 3 did, it is over 20 MB, far past the renderer's limit, as the
 * critic's real 2560 px cutouts were.
 */
export async function photographicCutout(size: number): Promise<Buffer> {
  const cell = 16;
  const small = Math.max(1, Math.round(size / cell));
  const texture = await sharp(randomBytes(small * small * 3, 13), {
    raw: { width: small, height: small, channels: 3 },
  })
    .resize(size, size, { kernel: "cubic" })
    .raw()
    .toBuffer();
  const grain = randomBytes(size * size, 11);
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      const n = (grain[i] / 255 - 0.5) * 4;
      rgba[i * 4] = clamp(texture[i * 3] / 2 + (x / size) * 100 + n);
      rgba[i * 4 + 1] = clamp(texture[i * 3 + 1] / 2 + (y / size) * 100 + n);
      rgba[i * 4 + 2] = clamp(texture[i * 3 + 2] / 2 + 60 + n);
      const distance = Math.hypot(x - radius, y - radius);
      rgba[i * 4 + 3] = clamp((radius - distance) * 4);
    }
  }
  return rgba;
}

const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));

export async function photographicCutoutPng(size: number): Promise<Buffer> {
  return sharp(await photographicCutout(size), {
    raw: { width: size, height: size, channels: 4 },
  })
    .png({ adaptiveFiltering: true, compressionLevel: 3 })
    .toBuffer();
}

/** The same picture with no alpha, as the normaliser sends a photo. */
export async function photographicJpeg(size: number): Promise<Buffer> {
  return sharp(await photographicCutout(size), {
    raw: { width: size, height: size, channels: 4 },
  })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
}

const SIDE = 4096;

function noiseScanlines(seed: number): Buffer {
  const rows = randomBytes((SIDE + 1) * SIDE, seed);
  for (let y = 0; y < SIDE; y += 1) rows[y * (SIDE + 1)] = 0;
  return deflateSync(rows, { level: 1 });
}

function palette(): Buffer {
  const entries = Buffer.alloc(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    entries.set([(i * 37) & 255, (i * 91) & 255, 255 - i], i * 3);
  }
  return entries;
}

function noisePng(colourType: 0 | 3, transparency: boolean): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    ihdrChunk({
      width: SIDE,
      height: SIDE,
      bitDepth: 8,
      colourType,
      interlaced: false,
    }),
    ...(colourType === 3 ? [pngChunk("PLTE", palette())] : []),
    ...(transparency ? [pngChunk("tRNS", Buffer.alloc(256, 200))] : []),
    pngChunk("IDAT", noiseScanlines(colourType * 2 + (transparency ? 1 : 0))),
    pngChunk("IEND"),
  ]);
}

/* sharp cannot write restart markers, so this writes the entropy-coded data
   itself: random quantised coefficients rather than pixels, which needs no
   DCT, Huffman tables with every symbol at 4 bits, which need no code
   search, and a restart marker after every MCU, the critic's rst1 shape. */
const BITS_PER_SYMBOL = 4;
const DC_SYMBOLS = 12;
const AC_SYMBOLS = 11;
const AC_PER_BLOCK = 10;
const QUANT_STEP = 2;

class BitWriter {
  private readonly chunks: Buffer[] = [];
  private buffer = Buffer.alloc(1 << 20);
  private length = 0;
  private bits = 0;
  private bitCount = 0;

  write(value: number, count: number) {
    for (let i = count - 1; i >= 0; i -= 1) {
      this.bits = (this.bits << 1) | ((value >> i) & 1);
      this.bitCount += 1;
      if (this.bitCount === 8) this.flushByte();
    }
  }

  /* A scan pads its last byte with ones before a marker. */
  alignWithOnes() {
    while (this.bitCount !== 0) this.write(1, 1);
  }

  marker(code: number) {
    this.push(0xff);
    this.push(code);
  }

  finish(): Buffer {
    this.chunks.push(this.buffer.subarray(0, this.length));
    return Buffer.concat(this.chunks);
  }

  private flushByte() {
    const byte = this.bits & 0xff;
    this.push(byte);
    if (byte === 0xff) this.push(0x00);
    this.bits = 0;
    this.bitCount = 0;
  }

  private push(byte: number) {
    if (this.length === this.buffer.length) {
      this.chunks.push(this.buffer);
      this.buffer = Buffer.alloc(1 << 20);
      this.length = 0;
    }
    this.buffer[this.length] = byte;
    this.length += 1;
  }
}

const sizeOf = (value: number) =>
  value === 0 ? 0 : 32 - Math.clz32(Math.abs(value));
const amplitudeBits = (value: number) =>
  value > 0 ? value : value + (1 << sizeOf(value)) - 1;

function segment(marker: number, body: number[]): Buffer {
  const length = body.length + 2;
  return Buffer.from([0xff, marker, length >> 8, length & 0xff, ...body]);
}

function uniformHuffmanTable(tableClass: 0 | 1, symbols: number): number[] {
  const counts = Array.from({ length: 16 }, (_, i) =>
    i === BITS_PER_SYMBOL - 1 ? symbols : 0,
  );
  return [
    tableClass << 4,
    ...counts,
    ...Array.from({ length: symbols }, (_, i) => i),
  ];
}

export function restartMarkerNoiseJpeg(side = SIDE): Buffer {
  const random = randomBytes(side * side * 2, 17);
  let next = 0;
  const randomByte = () => {
    next = (next + 1) % random.length;
    return random[next];
  };
  const out = new BitWriter();
  const blocksPerSide = side / 8;
  const mcus = blocksPerSide * blocksPerSide;
  for (let mcu = 0; mcu < mcus; mcu += 1) {
    for (let component = 0; component < 3; component += 1) {
      const dc = randomByte() - 128;
      out.write(sizeOf(dc), BITS_PER_SYMBOL);
      out.write(amplitudeBits(dc), sizeOf(dc));
      for (let k = 0; k < AC_PER_BLOCK; k += 1) {
        const magnitude = 1 + (randomByte() % 40);
        const ac = randomByte() & 1 ? magnitude : -magnitude;
        out.write(sizeOf(ac), BITS_PER_SYMBOL);
        out.write(amplitudeBits(ac), sizeOf(ac));
      }
      out.write(0, BITS_PER_SYMBOL);
    }
    if (mcu < mcus - 1) {
      out.alignWithOnes();
      out.marker(0xd0 + (mcu % 8));
    }
  }
  out.alignWithOnes();
  const scan = out.finish();

  const sizeBytes = [side >> 8, side & 0xff];
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xdb, [0, ...Array(64).fill(QUANT_STEP)]),
    segment(0xc0, [
      8,
      ...sizeBytes,
      ...sizeBytes,
      3,
      1,
      0x11,
      0,
      2,
      0x11,
      0,
      3,
      0x11,
      0,
    ]),
    segment(0xc4, [
      ...uniformHuffmanTable(0, DC_SYMBOLS),
      ...uniformHuffmanTable(1, AC_SYMBOLS),
    ]),
    segment(0xdd, [0, 1]),
    segment(0xda, [3, 1, 0x00, 2, 0x00, 3, 0x00, 0, 63, 0]),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}

/* 4:2:0, so the file is 17 MB and fits the 20 MB upload cap; at 4:4:4 it is
   34 MB, which storage refuses before the loader ever sees it. */
async function noiseJpeg(progressive: boolean): Promise<Buffer> {
  return sharp(randomBytes(SIDE * SIDE * 3, 5), {
    raw: { width: SIDE, height: SIDE, channels: 3 },
  })
    .jpeg({ quality: 95, chromaSubsampling: "4:2:0", progressive })
    .toBuffer();
}

/**
 * The most bytes per pixel a file under the 20 MB and 4096 px caps can
 * decode to: one random byte a pixel expands to three or four on re-encode.
 * The tRNS one is the worst cost the critic measured (3.5 s, 405 MB).
 */
export async function attackerSizedImages(): Promise<
  { name: string; type: "png" | "jpeg"; bytes: Buffer }[]
> {
  return [
    {
      name: "huge-4096-palette-noise.png",
      type: "png",
      bytes: noisePng(3, false),
    },
    {
      name: "huge-4096-gray-noise.png",
      type: "png",
      bytes: noisePng(0, false),
    },
    {
      name: "huge-4096-palette-noise-trns.png",
      type: "png",
      bytes: noisePng(3, true),
    },
    {
      name: "huge-4096-noise-q95.jpg",
      type: "jpeg",
      bytes: await noiseJpeg(false),
    },
    {
      name: "huge-4096-noise-q95-prog.jpg",
      type: "jpeg",
      bytes: await noiseJpeg(true),
    },
    {
      name: "huge-4096-noise-rst1.jpg",
      type: "jpeg",
      bytes: restartMarkerNoiseJpeg(),
    },
  ];
}
