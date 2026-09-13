import { describe, expect, it } from "vitest";
import {
  svgIntrinsicRatio,
  svgRasterBox,
  withViewBox,
} from "@/lib/images/rasterize";

const bytes = (markup: string) => new TextEncoder().encode(markup);

describe("svgIntrinsicRatio", () => {
  it("reads a viewBox", () => {
    expect(svgIntrinsicRatio(bytes('<svg viewBox="0 0 300 100"></svg>'))).toBe(
      3,
    );
  });

  it("reads a comma-separated viewBox", () => {
    expect(
      svgIntrinsicRatio(bytes('<svg viewBox="0,0,100,200"></svg>')),
    ).toBeCloseTo(0.5);
  });

  it("ignores a non-zero origin", () => {
    expect(
      svgIntrinsicRatio(bytes('<svg viewBox="-10 -10 400 200"></svg>')),
    ).toBe(2);
  });

  /* viewBox wins: export tools emit width="100%" alongside a real viewBox,
     and a percentage parses as the number 100 — square, and wrong. */
  it("prefers the viewBox over width and height", () => {
    expect(
      svgIntrinsicRatio(
        bytes('<svg width="100%" height="100%" viewBox="0 0 800 200"></svg>'),
      ),
    ).toBe(4);
  });

  it("falls back to width and height attributes", () => {
    expect(
      svgIntrinsicRatio(bytes('<svg width="240" height="60"></svg>')),
    ).toBe(4);
  });

  it("accepts px units on those attributes", () => {
    expect(
      svgIntrinsicRatio(bytes('<svg width="240px" height="120px"></svg>')),
    ).toBe(2);
  });

  it("looks past an XML declaration and a comment", () => {
    expect(
      svgIntrinsicRatio(
        bytes(
          '<?xml version="1.0"?><!-- made by hand --><svg viewBox="0 0 50 25"></svg>',
        ),
      ),
    ).toBe(2);
  });

  it("assumes square when nothing is declared", () => {
    expect(svgIntrinsicRatio(bytes("<svg></svg>"))).toBe(1);
  });

  it("assumes square rather than dividing by a zero dimension", () => {
    expect(svgIntrinsicRatio(bytes('<svg viewBox="0 0 100 0"></svg>'))).toBe(1);
    expect(svgIntrinsicRatio(bytes('<svg width="0" height="10"></svg>'))).toBe(
      1,
    );
  });

  it("assumes square on unparseable values", () => {
    expect(
      svgIntrinsicRatio(bytes('<svg viewBox="none none none none"></svg>')),
    ).toBe(1);
  });
});

describe("svgIntrinsicRatio reads the root tag only", () => {
  /* A descendant viewBox is a different coordinate system. Matching the first
     one anywhere reported a 3:1 logo as square — a silent 3x stretch. */
  it("ignores a viewBox on a descendant", () => {
    expect(
      svgIntrinsicRatio(
        bytes(
          '<svg width="300" height="100"><symbol viewBox="0 0 10 10"/></svg>',
        ),
      ),
    ).toBe(3);
  });

  it("still prefers a root viewBox over root width and height", () => {
    expect(
      svgIntrinsicRatio(
        bytes(
          '<svg viewBox="0 0 800 200" width="100%"><symbol viewBox="0 0 9 1"/></svg>',
        ),
      ),
    ).toBe(4);
  });
});

describe("svgRasterBox", () => {
  it("uses the preferred width when nothing needs clamping", () => {
    expect(svgRasterBox(bytes('<svg viewBox="0 0 2 1"/>'), 600)).toEqual({
      width: 600,
      height: 300,
    });
  });

  /* Clamping only the height left the width at its requested value, turning a
     1:100 mark into a 600x4096 box — a 14x horizontal stretch, silently. */
  it("clamps a very tall mark on both sides", () => {
    const box = svgRasterBox(bytes('<svg viewBox="0 0 1 100"/>'), 600);
    expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(4096);
    expect(box.width / box.height).toBeCloseTo(0.01, 3);
  });

  it("clamps a very wide mark on both sides", () => {
    const box = svgRasterBox(bytes('<svg viewBox="0 0 100 1"/>'), 600);
    expect(Math.max(box.width, box.height)).toBeLessThanOrEqual(4096);
    expect(box.width / box.height).toBeCloseTo(100, 0);
  });

  it("never returns a zero side", () => {
    const box = svgRasterBox(bytes('<svg viewBox="0 0 5000 1"/>'), 600);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe("withViewBox", () => {
  const text = (b: Uint8Array) => new TextDecoder().decode(b);

  /* satori throws without a viewBox, so an ordinary width/height SVG — which
     every drawing tool emits — was refused and the brand told its logo was
     broken. */
  it("gives a width/height SVG the viewBox satori demands", () => {
    const out = text(withViewBox(bytes('<svg width="300px" height="100px"/>')));
    expect(out).toContain('viewBox="0 0 300 100"');
  });

  it("leaves an SVG that already declares one untouched", () => {
    const original = '<svg viewBox="0 0 4 2" width="400"/>';
    expect(text(withViewBox(bytes(original)))).toBe(original);
  });

  it("does not count a descendant viewBox as the root's", () => {
    const out = text(
      withViewBox(
        bytes(
          '<svg width="300" height="100"><symbol viewBox="0 0 1 1"/></svg>',
        ),
      ),
    );
    expect(out).toContain('<svg viewBox="0 0 300 100"');
  });

  it("leaves an SVG that declares nothing alone", () => {
    expect(text(withViewBox(bytes("<svg/>")))).toBe("<svg/>");
  });
});
