// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import { closeRenderPool } from "@/lib/design/render/satori-pool";
import { decodePngRgba } from "@/lib/images/png-pixels";
import { documentElement } from "./render";
import { designDocumentSchema } from "./schema";
import {
  largePng,
  WORST_IMAGE_KEY,
  WORST_LOGO_KEY,
  worstCaseDocument,
} from "./testing-cost";

/**
 * The costliest document the schema accepts draws in bounded time.
 *
 * Uncontended on a 10-core dev machine it takes about 1.8s (best of three;
 * testing-cost.ts measures it). The bound here is several times
 * that because the full suite saturates every core; what it catches is a cap
 * loosened back towards the 59.5s a document of 200 shapes took.
 */

const BOUND_MS = 12_000;

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
});
afterAll(closeRenderPool);

it("rasterises the worst valid document within the bound", async () => {
  const doc = designDocumentSchema.parse(worstCaseDocument());
  const dataUri = (bytes: Uint8Array) =>
    `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  const sources = {
    [WORST_IMAGE_KEY]: dataUri(largePng()),
    [WORST_LOGO_KEY]: dataUri(largePng(512)),
  };
  const canvas = { width: doc.width, height: doc.height };
  await rasterize(
    documentElement({ ...doc, elements: [] }, sources),
    canvas,
    fonts,
  );

  const started = performance.now();
  const png = await rasterize(documentElement(doc, sources), canvas, fonts);
  const took = performance.now() - started;

  expect(decodePngRgba(png)?.height).toBe(doc.height);
  expect(took).toBeLessThan(BOUND_MS);
}, 60_000);
