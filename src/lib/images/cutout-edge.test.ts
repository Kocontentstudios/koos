// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cleanCutoutBytes, cleanCutoutEdge } from "./cutout-edge";

const W = 200;
const H = 140;

type Paint = (x: number, y: number) => number[] | null;

function image(paint: Paint): Uint8Array {
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const rgba = paint(x, y);
      if (rgba) px.set(rgba, (y * W + x) * 4);
    }
  }
  return px;
}

const at = (px: Uint8Array, x: number, y: number) =>
  Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));

/* A brown product over a low, opaque grey shadow cut out of white with a
   hard alpha line, and a white fringe on its top edge: the round-6 live
   critic's cut-out, small. */
const product: Paint = (x, y) => {
  if (y === 19 && x >= 60 && x < 140) return [250, 250, 250, 120];
  if (x >= 60 && x < 140 && y >= 20 && y < 90) return [120, 70, 30, 255];
  if (((x - 100) / 70) ** 2 + ((y - 100) / 12) ** 2 <= 1) {
    return [205, 205, 208, 255];
  }
  return null;
};

describe("cleanCutoutEdge", () => {
  it("draws a low grey shadow as translucent black that fades at its edge", () => {
    const px = image(product);
    cleanCutoutEdge(px, W, H);
    const inside = at(px, 100, 100);
    expect(inside.slice(0, 3)).toEqual([0, 0, 0]);
    expect(inside[3]).toBeLessThan(60);
    const run = [169, 167, 164, 160].map((x) => at(px, x, 100)[3]);
    for (let i = 1; i < run.length; i += 1) {
      expect(run[i]).toBeGreaterThanOrEqual(run[i - 1]);
    }
  });

  it("keeps the product's own pixels", () => {
    const px = image(product);
    cleanCutoutEdge(px, W, H);
    expect(at(px, 60, 50)).toEqual([120, 70, 30, 255]);
    expect(at(px, 100, 50)).toEqual([120, 70, 30, 255]);
  });

  it("gives the fringe the product's colour, not the sweep's white", () => {
    const px = image(product);
    cleanCutoutEdge(px, W, H);
    expect(at(px, 100, 19).slice(0, 3)).toEqual([120, 70, 30]);
  });

  /* Round-7 code critic, K19: a grey kettle, planter or phone became a
     see-through black disc. */
  it("never repaints a grey product", () => {
    const grey: Paint = (x, y) =>
      ((x - 100) / 60) ** 2 + ((y - 70) / 50) ** 2 <= 1
        ? [150, 150, 152, 255]
        : null;
    const px = image(grey);
    const before = px.slice();
    cleanCutoutEdge(px, W, H);
    expect(px).toEqual(before);
  });

  /* Round-7 code critic: a white cake's shaded rim was stripped. */
  it("never strips a white product's shaded rim", () => {
    const cake: Paint = (x, y) => {
      const r = Math.hypot(x - 100, y - 70);
      if (r <= 40) return [250, 250, 248, 255];
      if (r <= 55) return [205, 205, 206, 255];
      return null;
    };
    const px = image(cake);
    const before = px.slice();
    cleanCutoutEdge(px, W, H);
    expect(at(px, 100, 18)).toEqual(
      Array.from(before.slice((18 * W + 100) * 4, (18 * W + 100) * 4 + 4)),
    );
    expect(at(px, 100, 122)).toEqual(
      Array.from(before.slice((122 * W + 100) * 4, (122 * W + 100) * 4 + 4)),
    );
  });

  it("returns the input when the bytes cannot be read", async () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(await cleanCutoutBytes(junk)).toBe(junk);
  });
});
