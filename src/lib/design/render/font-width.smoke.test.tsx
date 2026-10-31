// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFontBytes } from "./font-file";
import { buildFont, OUTLINE_GLYPH } from "./font-fixtures";
import type { LoadedFont } from "./fonts";
import { closeRenderPool, RenderTimeoutError, renderPng } from "./satori-pool";

/**
 * R4-1, end to end: the faces font-file.ts refuses for a wide glyph outside
 * any cmap range really do loop satori, and the same fixture shapes within
 * the bound draw. Without this the unit tests would only prove the check
 * agrees with itself.
 *
 * The line is narrower than the wide glyph and breaks words, the one shape
 * that loops (document/render.tsx minBreakableWidth keeps every real layout
 * out of it, and the check keeps every glyph within that bound).
 */

/* U+2B739 sends next/og to Google Fonts for a face. On a slow or cold
   network that fetch alone can outlast LIMIT_MS, which reads as the loop
   this file exists to catch. The fake network answers it at once with a
   miss, so a timeout here can only be satori looping. */
beforeAll(async () => {
  await closeRenderPool();
  process.env.KOOS_OG_FAKE_NETWORK = "ok";
});
afterAll(async () => {
  await closeRenderPool();
  delete process.env.KOOS_OG_FAKE_NETWORK;
});

const WIDE = 9000;
const LIMIT_MS = 4000;

function face(bytes: Uint8Array): LoadedFont[] {
  return [
    {
      name: "Brand",
      data: bytes.slice().buffer as ArrayBuffer,
      weight: 400,
      style: "normal",
    },
  ];
}

const narrowLine = (text: string) => (
  <div style={{ display: "flex", width: 400, height: 200, background: "#fff" }}>
    <div
      style={{
        width: 120,
        fontFamily: "Brand",
        fontSize: 40,
        wordBreak: "break-word",
      }}
    >
      {text}
    </div>
  </div>
);

/* One LoadedFont per face, as fonts.ts caches them: the pool keys a face
   by its buffer, and a worker keeps the parsed face only for the same key. */
const loaded = new Map<Uint8Array, LoadedFont[]>();
const draw = (bytes: Uint8Array, text: string) => {
  if (!loaded.has(bytes)) loaded.set(bytes, face(bytes));
  return renderPng(
    narrowLine(text),
    { width: 400, height: 200 },
    loaded.get(bytes) ?? [],
    { limitMs: LIMIT_MS },
  );
};

/* The pool's default of two workers, plus one. */
const DRAWS_TO_REVISIT_A_WORKER = 3;

describe("glyph widths satori reaches outside the cmap", () => {
  it("draws the CFF fixture, so its refusal below is about width alone", async () => {
    const bytes = buildFont({ cff: {} });
    expect(checkFontBytes(bytes)).toEqual({ ok: true });
    await expect(draw(bytes, "AAAA")).resolves.toBeInstanceOf(Uint8Array);
  });

  /* The hmtx advance is 0.5em, so a layout before the glyph is drawn is
     fine. Drawing it replaces that with the charstring's 9em for every
     later render in that worker, which keeps parsed faces. */
  it("loops on a CFF glyph whose charstring is wider than its hmtx advance", async () => {
    const bytes = buildFont({ cff: { widths: { [OUTLINE_GLYPH]: WIDE } } });
    expect(checkFontBytes(bytes).ok).toBe(false);
    await expect(draw(bytes, "AAAA")).resolves.toBeInstanceOf(Uint8Array);
    const outcomes: unknown[] = [];
    for (let i = 1; i < DRAWS_TO_REVISIT_A_WORKER; i += 1) {
      outcomes.push(await draw(bytes, "AAAA").catch((error) => error));
    }
    expect(outcomes.some((o) => o instanceof RenderTimeoutError)).toBe(true);
  }, 30_000);

  /* U+2B739 is in no face, so satori draws the brand face's .notdef. */
  it("loops on a wide .notdef reached by a code point no face covers", async () => {
    const bytes = buildFont({ advances: { 0: WIDE } });
    expect(checkFontBytes(bytes).ok).toBe(false);
    await expect(draw(bytes, "A\u{2B739}A")).rejects.toBeInstanceOf(
      RenderTimeoutError,
    );
    await expect(
      draw(buildFont({ advances: { 0: 2000 } }), "A\u{2B739}A"),
    ).resolves.toBeInstanceOf(Uint8Array);
  }, 20_000);
});
