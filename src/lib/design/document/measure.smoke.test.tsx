// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { type LoadedFont, loadBrandFonts } from "@/lib/design/render/fonts";
import { rasterize } from "@/lib/design/render/rasterize";
import { decodePngRgba } from "@/lib/images/png-pixels";
import type { TextLook } from "./fit";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import { textRunStyle } from "./render";
import { TEST_PROBE_LIMIT_MS } from "./testing-measure";

/**
 * The measurer reads a 8px sliver of a probe. These tests lay the same run
 * out on a full-size canvas with its box painted red and count the red rows
 * and columns, so a probe that disagrees with a real render cannot pass.
 */

let fonts: LoadedFont[];
let measurer: RendererMeasurer;
beforeAll(async () => {
  fonts = await loadBrandFonts(null);
  measurer = createRendererMeasurer({
    probeLimitMs: TEST_PROBE_LIMIT_MS,
    fonts,
  });
});

const RED = "#FF0000";

function isRed(pixels: Uint8Array, at: number) {
  return pixels[at] > 240 && pixels[at + 1] < 15 && pixels[at + 2] < 15;
}

async function redExtent(
  element: React.ReactElement,
  canvas: { width: number; height: number },
): Promise<{ width: number; height: number }> {
  const png = decodePngRgba(await rasterize(element, canvas, fonts));
  if (!png) throw new Error("render did not decode");
  let rows = 0;
  let right = 0;
  for (let y = 0; y < png.height; y += 1) {
    let any = false;
    for (let x = 0; x < png.width; x += 1) {
      if (isRed(png.pixels, (y * png.width + x) * 4)) {
        any = true;
        right = Math.max(right, x + 1);
      }
    }
    if (any) rows += 1;
  }
  return { width: right, height: rows };
}

const HEADLINE: TextLook = {
  font: "heading",
  fontSize: 96,
  fontWeight: 700,
  lineHeight: 1.05,
  letterSpacing: -0.01,
  align: "center",
  italic: false,
};
const BODY: TextLook = {
  font: "body",
  fontSize: 38,
  fontWeight: 400,
  lineHeight: 1.35,
  letterSpacing: 0,
  align: "left",
  italic: false,
};

const TEXTS = [
  "Fresh croissants, baked before sunrise",
  "Our Christmas pre-order window closes Friday: reserve croissants now!!",
  "Butter croissants, almond twice-baked, pain au chocolat and our seasonal panettone, all baked fresh at dawn, and boxed ready for collection.",
];

describe("createRendererMeasurer", () => {
  it.each([
    ["headline", HEADLINE, 908],
    ["headline", HEADLINE, 390],
    ["body", BODY, 908],
    ["body", BODY, 390],
  ] as const)(
    "measures a %s run (case %#) exactly as a full render lays it out",
    async (_name, look, width) => {
      for (const text of TEXTS) {
        const measured = await measurer.height(text, look, width);
        const actual = await redExtent(
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              width: width + 40,
              height: 3000,
              backgroundColor: "#FFFFFF",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                width,
                backgroundColor: RED,
              }}
            >
              <div style={textRunStyle({ ...look, color: "#000000" })}>
                {text}
              </div>
            </div>
          </div>,
          { width: width + 40, height: 3000 },
        );
        expect(measured, text).toBe(actual.height);
      }
    },
    60_000,
  );

  it("measures one-line width as a full render does", async () => {
    const look = { ...BODY, fontWeight: 600 as const, lineHeight: 1.2 };
    const label = "Order for pickup";
    const measured = await measurer.lineWidth(label, look);
    const actual = await redExtent(
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          width: 1200,
          height: 200,
          backgroundColor: "#FFFFFF",
        }}
      >
        <div
          style={{
            ...textRunStyle({ ...look, color: "#000000" }),
            whiteSpace: "nowrap",
            textWrap: "wrap",
            backgroundColor: RED,
            flexShrink: 0,
          }}
        >
          {label}
        </div>
      </div>,
      { width: 1200, height: 200 },
    );
    expect(measured).toBe(actual.width);
  });

  it("reports the widest word, which bounds every wrapped line", async () => {
    const text = TEXTS[1];
    const widest = await measurer.widestWord(text, HEADLINE);
    const whole = await measurer.lineWidth(text, HEADLINE);
    const oneWord = await measurer.lineWidth("croissants", HEADLINE);
    expect(widest).toBeGreaterThanOrEqual(oneWord);
    expect(widest).toBeLessThan(whole);
  });

  it("grows monotonically with size, which the binary search relies on", async () => {
    let previous = 0;
    for (let size = 30; size <= 130; size += 10) {
      const height = await measurer.height(
        TEXTS[0],
        { ...HEADLINE, fontSize: size },
        700,
      );
      expect(height).toBeGreaterThanOrEqual(previous);
      previous = height;
    }
  });

  it("caches repeated questions instead of rendering them again", async () => {
    const fresh = createRendererMeasurer({
      probeLimitMs: TEST_PROBE_LIMIT_MS,
      fonts,
    });
    await fresh.height(TEXTS[0], HEADLINE, 500);
    await fresh.height(TEXTS[0], HEADLINE, 500);
    expect(fresh.probes()).toBe(1);
  });

  it("reads a run too tall for any canvas as infinitely tall", async () => {
    const height = await measurer.height(
      TEXTS[2].repeat(12),
      { ...BODY, fontSize: 90 },
      200,
    );
    expect(height).toBe(Number.POSITIVE_INFINITY);
  });
});
