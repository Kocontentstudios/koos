// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanCutoutBytes, cleanCutoutEdge } from "./cutout-edge";

const W = 200;
const H = 120;

/* A brown product on an opaque grey shadow, cut out of white with a hard
   alpha line, and a one-pixel white fringe on the product's top edge: the
   round-6 live critic's cut-out, small. */
function cutout(): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  const set = (x: number, y: number, rgba: number[]) => {
    px.set(rgba, (y * W + x) * 4);
  };
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const inShadow = ((x - 100) / 90) ** 2 + ((y - 80) / 30) ** 2 <= 1;
      const inProduct = x >= 60 && x < 140 && y >= 30 && y < 80;
      if (inProduct) set(x, y, [120, 70, 30, 255]);
      else if (inShadow) set(x, y, [205, 205, 208, 255]);
    }
  }
  for (let x = 60; x < 140; x += 1) set(x, 29, [250, 250, 250, 120]);
  return px;
}

const alphaAt = (px: Uint8Array, x: number, y: number) =>
  px[(y * W + x) * 4 + 3];

describe("cleanCutoutEdge", () => {
  it("draws the grey shadow as translucent black that fades out at its edge", () => {
    const px = cutout();
    cleanCutoutEdge(px, W, H);
    const inside = (100 * W + 100) * 4;
    expect([px[inside], px[inside + 1], px[inside + 2]]).toEqual([0, 0, 0]);
    expect(px[inside + 3]).toBe(Math.round(255 * ((255 - 205.2) / 255)));
    /* The shadow's rightmost run, from its edge inwards. */
    const run = [189, 188, 186, 184, 180].map((x) => alphaAt(px, x, 80));
    expect(run[0]).toBeLessThan(px[inside + 3]);
    for (let i = 1; i < run.length; i += 1) {
      expect(run[i]).toBeGreaterThanOrEqual(run[i - 1]);
    }
  });

  it("keeps the product's own edge sharp", () => {
    const px = cutout();
    cleanCutoutEdge(px, W, H);
    expect(alphaAt(px, 60, 50)).toBe(255);
    expect(alphaAt(px, 139, 50)).toBe(255);
  });

  it("gives the fringe the product's colour, not the sweep's white", () => {
    const px = cutout();
    cleanCutoutEdge(px, W, H);
    const o = (29 * W + 100) * 4;
    expect([px[o], px[o + 1], px[o + 2]]).toEqual([120, 70, 30]);
  });

  it("returns the input when the bytes cannot be read", async () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(await cleanCutoutBytes(junk)).toBe(junk);
  });
});
