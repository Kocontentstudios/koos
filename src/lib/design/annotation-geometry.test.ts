import { describe, expect, it } from "vitest";
import { toNormalized, toPixels } from "./annotation-geometry";

describe("toNormalized", () => {
  it("converts pixel coords to a 0-1 fraction of the given size", () => {
    expect(toNormalized({ x: 50, y: 25 }, { w: 100, h: 100 })).toEqual({
      x: 0.5,
      y: 0.25,
    });
  });

  it("clamps out-of-range pixels to [0,1]", () => {
    expect(toNormalized({ x: -20, y: 500 }, { w: 200, h: 200 })).toEqual({
      x: 0,
      y: 1,
    });
  });
});

describe("toPixels", () => {
  it("converts a normalized fraction back to pixel coords", () => {
    expect(toPixels({ x: 0.5, y: 0.25 }, { w: 100, h: 100 })).toEqual({
      x: 50,
      y: 25,
    });
  });

  it("clamps out-of-range fractions to [0,1] before scaling", () => {
    expect(toPixels({ x: -1, y: 2 }, { w: 200, h: 200 })).toEqual({
      x: 0,
      y: 200,
    });
  });

  it("round-trips through toNormalized for in-range values", () => {
    const size = { w: 300, h: 150 };
    const px = { x: 120, y: 45 };
    expect(toPixels(toNormalized(px, size), size)).toEqual(px);
  });
});
