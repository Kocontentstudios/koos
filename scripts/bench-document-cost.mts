/**
 * Periodic lane: times the costliest document the schema accepts, alone and
 * two at once on the render pool, against the 3 s bound in the spec.
 *
 * Run before shipping any change to DOCUMENT_LIMITS or the renderer, on an
 * otherwise idle machine: `corepack pnpm bench:document-cost`. Wall-clock
 * time is a property of the machine and its load, which is why this is not a
 * gate test; the gate (`cost.smoke.test.ts`) pins the caps measured here.
 * Exits 1 when either figure is over the bound. With `--record`, a run under
 * the bound writes the caps and figures to cost-bench.json, which is how a
 * deliberate change to any cost bound gets past the gate.
 */

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { documentElement } from "@/lib/design/document/render";
import { designDocumentSchema } from "@/lib/design/document/schema";
import {
  currentCaps,
  largePng,
  WORST_IMAGE_KEY,
  WORST_LOGO_KEY,
  worstCaseDocument,
} from "@/lib/design/document/testing-cost";
import { cacheOgAssets } from "@/lib/design/document/testing-og-assets";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import {
  closeRenderPool,
  renderPoolStats,
} from "@/lib/design/render/satori-pool";
import { decodePngRgba } from "@/lib/images/png-pixels";

const BOUND_MS = 3_000;
const RUNS = 3;

cacheOgAssets();

const dataUri = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

const fonts = await loadBrandFonts(null);
const doc = designDocumentSchema.parse(worstCaseDocument());
const sources = {
  [WORST_IMAGE_KEY]: dataUri(largePng()),
  [WORST_LOGO_KEY]: dataUri(largePng(512)),
};
const canvas = { width: doc.width, height: doc.height };

async function timed(): Promise<number> {
  const started = performance.now();
  const png = await rasterize(documentElement(doc, sources), canvas, fonts);
  if (decodePngRgba(png)?.height !== doc.height) {
    throw new Error("worst-case render came back the wrong size");
  }
  return performance.now() - started;
}

/* The first render on each worker also pays the fallback-face and emoji
   fetches, which the render limit bounds separately. */
await Promise.all([timed(), timed()]);
const workers = renderPoolStats().workers;

const alone: number[] = [];
const pair: number[] = [];
for (let i = 0; i < RUNS; i += 1) {
  alone.push(await timed());
  pair.push(Math.max(...(await Promise.all([timed(), timed()]))));
}
await closeRenderPool();

const best = (times: number[]) => Math.round(Math.min(...times));
const worst = (times: number[]) => Math.round(Math.max(...times));
const report = {
  caps: currentCaps(),
  workers,
  boundMs: BOUND_MS,
  aloneMs: { best: best(alone), worst: worst(alone) },
  pairMs: { best: best(pair), worst: worst(pair) },
};
console.log(JSON.stringify(report, null, 2));

if (best(alone) >= BOUND_MS || best(pair) >= BOUND_MS) {
  console.error(`over the ${BOUND_MS} ms bound`);
  process.exit(1);
}

if (process.argv.includes("--record")) {
  const recorded = {
    caps: report.caps,
    measured: {
      /* Ties the figures to the caps they were timed under, so editing the
         caps by hand to match a loosened schema shows as a stale digest. */
      capsDigest: createHash("sha256")
        .update(JSON.stringify(report.caps))
        .digest("hex"),
      date: new Date().toISOString().slice(0, 10),
      boundMs: BOUND_MS,
      aloneMs: report.aloneMs.best,
      pairMs: report.pairMs.best,
      workers,
    },
  };
  await writeFile(
    new URL("../src/lib/design/document/cost-bench.json", import.meta.url),
    `${JSON.stringify(recorded, null, 2)}\n`,
  );
  console.log("recorded cost-bench.json");
}
