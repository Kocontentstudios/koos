/**
 * What the libvips re-encode adds to loading a design image, at the sizes
 * that matter: the browser normaliser's 2560 px JPEG, and a 4096 px PNG from
 * a client that skipped it (opaque, and with alpha, which takes the slower
 * raw branch). The structural pre-filter that runs first is timed alongside
 * for scale.
 *
 * Usage: corepack pnpm bench:reencode
 */
import sharp from "sharp";
import { jpegDecodes, pngDecodes } from "../src/lib/images/decode-check";
import { reencodeImage } from "../src/lib/images/reencode";

const RUNS = 7;
const LIMITS = { maxInputPixels: 4096 * 4096 };

/* Blurred noise compresses like a photograph; a flat fill would flatter the
   encoder. */
function noise(width: number, height: number, channels: 3 | 4): Buffer {
  const pixels = Buffer.alloc(width * height * channels);
  let seed = 1;
  for (let i = 0; i < pixels.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = channels === 4 && i % 4 === 3 ? 200 : seed >>> 23;
  }
  return pixels;
}

async function photo(width: number, height: number, channels: 3 | 4) {
  return sharp(noise(width, height, channels), {
    raw: { width, height, channels },
  }).blur(1.5);
}

async function timed(run: () => Promise<unknown>) {
  await run();
  const times: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const started = performance.now();
    await run();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { median: times[RUNS >> 1], min: times[0], max: times[RUNS - 1] };
}

const cases = [
  {
    label: "2560x1707 JPEG q90",
    type: "jpeg" as const,
    bytes: await (await photo(2560, 1707, 3)).jpeg({ quality: 90 }).toBuffer(),
  },
  {
    label: "4096x4096 PNG opaque",
    type: "png" as const,
    bytes: await (await photo(4096, 4096, 3)).png().toBuffer(),
  },
  {
    label: "4096x4096 PNG alpha",
    type: "png" as const,
    bytes: await (await photo(4096, 4096, 4)).png().toBuffer(),
  },
];

const fmt = (ms: number) => `${ms.toFixed(0)} ms`;
console.log(
  `node ${process.version}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}, ${RUNS} runs, median (min-max)`,
);
for (const { label, type, bytes } of cases) {
  const check = await timed(async () =>
    type === "png" ? pngDecodes(bytes) : jpegDecodes(bytes),
  );
  const reencode = await timed(() => reencodeImage(bytes, type, LIMITS));
  const out = await reencodeImage(bytes, type, LIMITS);
  console.log(
    [
      label.padEnd(22),
      `in ${(bytes.length / 1e6).toFixed(1)} MB`,
      `out ${(out.bytes.length / 1e6).toFixed(1)} MB`,
      `pre-filter ${fmt(check.median)}`,
      `re-encode ${fmt(reencode.median)} (${fmt(reencode.min)}-${fmt(reencode.max)})`,
    ].join("  "),
  );
}
