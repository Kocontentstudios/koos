/**
 * What preparing an uploaded image costs: the loader's re-encode at the sizes
 * that matter (the browser normaliser's 2560 px JPEG and RGBA cutout, a
 * 4096 px JPEG from a client that skipped it, and the two costliest files
 * within the caps, 4096 px palette noise with tRNS and a 4096 px progressive
 * noise JPEG), plus the SVG sanitiser on a typical logo. Each case runs in
 * a fresh process, so its peak RSS is its own: one cold run, then the median of the warm ones. The child loads only
 * the loader's modules, and peak RSS is read before the first run (startup),
 * after it (one load) and after all of them. Fixtures are built in a process
 * of their own too, because Linux carries a parent's peak RSS into a child it
 * forks, and a 4096 px fixture would otherwise be counted against the load.
 *
 * Usage: corepack pnpm bench:reencode
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { ReencodeOptions } from "../src/lib/images/reencode";

const WARM_RUNS = 5;

type Kind = "png" | "jpeg" | "svg";

interface Case {
  label: string;
  kind: Kind;
  build: () => Promise<Buffer>;
}

/* A vector mark, a wordmark and the metadata block design tools write,
   about the size and element count of an exported brand logo, with one
   small raster embedded as exporters do for a texture or a badge. */
async function typicalLogo(): Promise<Buffer> {
  const { photographicCutout } = await import(
    "../src/lib/images/large-image-fixtures"
  );
  const badge = await sharp(await photographicCutout(256), {
    raw: { width: 256, height: 256, channels: 4 },
  })
    .png()
    .toBuffer();
  const paths = Array.from({ length: 300 }, (_, i) => {
    const x = (i * 37) % 600;
    const y = (i * 53) % 200;
    return `<path d="M${x} ${y} c 4 -8 12 -8 16 0 s 12 8 16 0 l 4 12 q -10 10 -20 0 z" fill="url(#g)" opacity="${((i % 9) + 1) / 10}"/>`;
  }).join("");
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><!-- Generator: Adobe Illustrator 28.0 --><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 600 200"><metadata><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></metadata><defs><linearGradient id="g"><stop offset="0" stop-color="#f97316"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><style>.w{font:700 64px sans-serif;fill:url(#g)}</style><g>${paths}</g><text class="w" x="220" y="130">Acme</text><image x="20" y="20" width="160" height="160" xlink:href="data:image/png;base64,${badge.toString("base64")}"/></svg>`,
  );
}

const fixtures = () => import("../src/lib/images/large-image-fixtures");

async function attacker(name: string): Promise<Buffer> {
  const images = await (await fixtures()).attackerSizedImages();
  const found = images.find((i) => i.name === name);
  if (!found) throw new Error(`${name} missing`);
  return found.bytes;
}

const CASES: Case[] = [
  {
    label: "2560x2560 JPEG photo",
    kind: "jpeg",
    build: async () => (await fixtures()).photographicJpeg(2560),
  },
  {
    label: "2560x2560 RGBA PNG cutout",
    kind: "png",
    build: async () => (await fixtures()).photographicCutoutPng(2560),
  },
  {
    label: "4096x4096 JPEG photo",
    kind: "jpeg",
    build: async () => (await fixtures()).photographicJpeg(4096),
  },
  {
    label: "4096 palette noise + tRNS",
    kind: "png",
    build: () => attacker("huge-4096-palette-noise-trns.png"),
  },
  {
    label: "4096 progressive noise JPEG",
    kind: "jpeg",
    build: () => attacker("huge-4096-noise-q95-prog.jpg"),
  },
  { label: "SVG logo sanitiser", kind: "svg", build: typicalLogo },
];

const peakRssMb = () => process.resourceUsage().maxRSS / 1024;

async function measure(kind: Kind, file: string, options: ReencodeOptions) {
  const { jpegDecodes, pngDecodes } = await import(
    "../src/lib/images/decode-check"
  );
  const { reencodeImage } = await import("../src/lib/images/reencode");
  const { sanitizeSvg } = await import("../src/lib/images/svg-sanitize");
  const runOnce = async (bytes: Buffer) => {
    if (kind === "svg") {
      const safe = await sanitizeSvg(bytes);
      return { out: safe.bytes.length, size: "" };
    }
    const decodes =
      kind === "png" ? await pngDecodes(bytes) : jpegDecodes(bytes);
    if (!decodes) throw new Error("the pre-filter refused the fixture");
    const clean = await reencodeImage(bytes, kind, options);
    return { out: clean.bytes.length, size: `${clean.width}x${clean.height}` };
  };

  const bytes = readFileSync(file);
  const startupPeakRssMb = peakRssMb();
  let started = performance.now();
  const result = await runOnce(bytes);
  const cold = performance.now() - started;
  const coldPeakRssMb = peakRssMb();
  const warm: number[] = [];
  for (let i = 0; i < WARM_RUNS; i += 1) {
    started = performance.now();
    await runOnce(Buffer.from(bytes));
    warm.push(performance.now() - started);
  }
  warm.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      ...result,
      cold,
      median: warm[WARM_RUNS >> 1],
      startupPeakRssMb,
      coldPeakRssMb,
      warmPeakRssMb: peakRssMb(),
    }),
  );
}

async function build(index: number, file: string) {
  writeFileSync(file, await CASES[index].build());
  const { DESIGN_IMAGE_REENCODE } = await import(
    "../src/lib/uploads/design-image"
  );
  console.log(JSON.stringify(DESIGN_IMAGE_REENCODE));
}

function runSelf(...args: string[]): string {
  const run = spawnSync(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), ...args],
    { encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`${args[0]} failed:\n${run.stderr}`);
  return run.stdout.trim().split("\n").pop() ?? "";
}

function parent() {
  const dir = mkdtempSync(join(tmpdir(), "bench-reencode-"));
  const fmt = (ms: number) => `${ms.toFixed(0)} ms`;
  console.log(
    `node ${process.version}, sharp ${sharp.versions.sharp}, libvips ${sharp.versions.vips}; cold, then median of ${WARM_RUNS} warm, in a fresh process per case`,
  );
  try {
    for (const [i, { label, kind }] of CASES.entries()) {
      const file = join(dir, `${i}.bin`);
      const options = runSelf("--build", String(i), file);
      const r = JSON.parse(runSelf("--measure", kind, file, options));
      const bytes = readFileSync(file);
      console.log(
        [
          label.padEnd(26),
          `in ${(bytes.length / 1e6).toFixed(2)} MB`,
          `out ${(r.out / 1e6).toFixed(2)} MB ${r.size}`.padEnd(24),
          `cold ${fmt(r.cold)}`,
          `warm ${fmt(r.median)}`,
          `peak RSS: startup ${r.startupPeakRssMb.toFixed(0)} MB, one load ${r.coldPeakRssMb.toFixed(0)} MB, ${WARM_RUNS + 1} loads ${r.warmPeakRssMb.toFixed(0)} MB`,
        ].join("  "),
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [flag, arg, file, options] = process.argv.slice(2);
if (flag === "--build") await build(Number(arg), file);
else if (flag === "--measure") {
  await measure(arg as Kind, file, JSON.parse(options));
} else parent();
