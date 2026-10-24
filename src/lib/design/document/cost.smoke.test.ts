// @vitest-environment node
import { afterAll, beforeAll, expect, it } from "vitest";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import {
  closeRenderPool,
  renderPoolStats,
} from "@/lib/design/render/satori-pool";
import { decodePngRgba } from "@/lib/images/png-pixels";
import benched from "./cost-bench.json";
import { documentElement } from "./render";
import { designDocumentSchema } from "./schema";
import {
  currentCaps,
  largePng,
  WORST_IMAGE_KEY,
  WORST_LOGO_KEY,
  worstCaseDocument,
} from "./testing-cost";
import { cacheOgAssets } from "./testing-og-assets";

/**
 * The 3 s bound on the costliest valid document is timed by
 * `bench:document-cost` (periodic lane), not here: a wall-clock assertion
 * failed this suite whenever the machine was busy. The gate holds what is
 * deterministic: the worst case still draws, alone and two at once, and
 * every cost bound (each bound the schema enforces, read from the schema)
 * is the one the bench last timed, so changing any of them fails here until
 * `bench:document-cost --record` times it again.
 */

cacheOgAssets();

let fonts: Awaited<ReturnType<typeof loadBrandFonts>>;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
});
afterAll(closeRenderPool);

const dataUri = (bytes: Uint8Array) =>
  `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;

it("keeps the cost bounds the bench last timed", () => {
  expect(JSON.parse(JSON.stringify(currentCaps()))).toEqual(benched.caps);
});

it("draws the worst valid document, alone and two at once", async () => {
  const doc = designDocumentSchema.parse(worstCaseDocument());
  const sources = {
    [WORST_IMAGE_KEY]: dataUri(largePng()),
    [WORST_LOGO_KEY]: dataUri(largePng(512)),
  };
  const canvas = { width: doc.width, height: doc.height };
  const drawnHeight = async () =>
    decodePngRgba(await rasterize(documentElement(doc, sources), canvas, fonts))
      ?.height;

  expect(await drawnHeight()).toBe(doc.height);
  expect(await Promise.all([drawnHeight(), drawnHeight()])).toEqual([
    doc.height,
    doc.height,
  ]);
  expect(renderPoolStats().workers).toBeGreaterThanOrEqual(2);
}, 120_000);
