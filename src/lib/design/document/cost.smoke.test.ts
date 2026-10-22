// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import {
  closeRenderPool,
  renderPoolStats,
} from "@/lib/design/render/satori-pool";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { documentElement } from "./render";
import { designDocumentSchema } from "./schema";
import {
  largePng,
  WORST_IMAGE_KEY,
  WORST_LOGO_KEY,
  worstCaseDocument,
} from "./testing-cost";
import { cacheOgAssets } from "./testing-og-assets";

/**
 * The costliest document the schema accepts draws in under 3s, alone and
 * with a second one drawing beside it on the render pool.
 *
 * On a 10-core dev machine it takes about 2.0s on a warm worker, alone or
 * in a pair, and up to 2.7s on a worker's first render (testing-cost.ts
 * builds it). Round 3 claimed 1.8s for its caps while the same caps allowed
 * a 12.1s document, because its worst case was the wrong one; this one
 * spends the copy budget on the costliest glyphs, so a cap loosened past
 * the bound fails here. Each figure is the best of two attempts, so a
 * neighbour in the suite stealing a core does not fail it.
 */

const BOUND_MS = 3_000;

cacheOgAssets();

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
});
afterAll(closeRenderPool);

const dataUri = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

it("rasterises the worst valid document in under 3s, alone and two at once", async () => {
  const doc = designDocumentSchema.parse(worstCaseDocument());
  const sources = {
    [WORST_IMAGE_KEY]: dataUri(largePng()),
    [WORST_LOGO_KEY]: dataUri(largePng(512)),
  };
  const canvas = { width: doc.width, height: doc.height };
  const timed = async () => {
    const started = performance.now();
    const png = await rasterize(documentElement(doc, sources), canvas, fonts);
    expect(decodePngRgba(png)?.height).toBe(doc.height);
    return performance.now() - started;
  };

  /* Warm both workers: faces parsed, fallback faces fetched. */
  await Promise.all([timed(), timed()]);
  expect(renderPoolStats().workers).toBeGreaterThanOrEqual(2);

  const alone = Math.min(await timed(), await timed());
  const pairs = [
    await Promise.all([timed(), timed()]),
    await Promise.all([timed(), timed()]),
  ];
  const pair = Math.min(...pairs.map((times) => Math.max(...times)));

  expect(alone).toBeLessThan(BOUND_MS);
  expect(pair).toBeLessThan(BOUND_MS);
}, 120_000);
