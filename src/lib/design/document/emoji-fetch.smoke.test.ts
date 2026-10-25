// @vitest-environment node
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LoadedFont, loadBrandFonts } from "@/lib/design/render/fonts";
import {
  designOfRuns,
  designWith,
  EMOJI_SHAPES,
  LOOSE_PIECES,
  SEPARATORS,
} from "./emoji-shapes";
import { documentElement } from "./render";
import { type DesignDocument, designDocumentSchema } from "./schema";
import { MAX_EMOJI_PER_DOCUMENT } from "./text-safety";

/**
 * The emoji cap judged by next/og itself, not a model of it.
 *
 * Each accepted design is drawn by a fresh copy of the bundled renderer
 * (its picture cache is per module, so a fresh copy is a cold worker) with
 * fetch stubbed, and every picture it asks for is counted, request by
 * request: a model of next/og written into the gate keyed pictures by
 * getIconCode and counted too few, and counting distinct URLs here would
 * repeat that mistake. Rendering only at the cap, this lane checks what the
 * schema lets through; past the cap the render worker refuses the fetch
 * itself (emoji-budget.smoke.test.tsx).
 */

const OG = pathToFileURL(
  createRequire(import.meta.url).resolve(
    "next/dist/compiled/@vercel/og/index.node.js",
  ),
).href;
const PICTURE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36"><rect width="36" height="36"/></svg>';

let fonts: LoadedFont[];
let pictures: string[] = [];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("cdn.jsdelivr.net")) {
      pictures.push(url);
      return new Response(PICTURE);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

let fresh = 0;
async function picturesFetched(doc: DesignDocument): Promise<number> {
  const og = await import(/* @vite-ignore */ `${OG}?cold=${fresh++}`);
  pictures = [];
  const response = new og.ImageResponse(documentElement(doc, {}), {
    width: doc.width,
    height: doc.height,
    fonts: fonts.map(({ name, data, weight, style }) => ({
      name,
      data,
      weight,
      style,
    })),
  });
  await response.arrayBuffer();
  return pictures.length;
}

describe("next/og fetches no more pictures than the cap allows", () => {
  const cases = Object.entries(EMOJI_SHAPES).flatMap(([shape, clusters]) =>
    SEPARATORS.map(
      (separator) =>
        [shape, JSON.stringify(separator), clusters, separator] as const,
    ),
  );

  it.each(cases)(
    "%s at the cap, separated by %s",
    async (_, __, clusters, separator) => {
      const doc = designDocumentSchema.parse(
        designWith(clusters.slice(0, MAX_EMOJI_PER_DOCUMENT), separator),
      );
      const fetched = await picturesFetched(doc);
      /* A render that never asked for a picture would pass vacuously. */
      expect(fetched).toBeGreaterThan(0);
      expect(fetched).toBeLessThanOrEqual(MAX_EMOJI_PER_DOCUMENT);
    },
    60_000,
  );

  it.each(Object.entries(LOOSE_PIECES))(
    "a loose %s behind the cap's emoji adds no picture",
    async (_, piece) => {
      const clusters = EMOJI_SHAPES["plain pictograph"].slice(
        0,
        MAX_EMOJI_PER_DOCUMENT,
      );
      const runs = designWith(clusters, " ").elements.map((element) =>
        element.type === "text" ? element.text : "",
      );
      for (const glue of ["\n", "\r", "\r\n", ""]) {
        const parsed = designDocumentSchema.safeParse(
          designOfRuns(runs.map((text) => `${text}${glue}${piece}`)),
        );
        if (!parsed.success) continue;
        expect(await picturesFetched(parsed.data)).toBeLessThanOrEqual(
          MAX_EMOJI_PER_DOCUMENT,
        );
      }
    },
    120_000,
  );
});
