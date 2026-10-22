import { describe, expect, it } from "vitest";
import {
  contrast,
  gradientSamples,
  isBrandFamily,
  over,
  parseColor,
  toHex,
} from "./color";

const c = (value: string) => {
  const parsed = parseColor(value);
  if (!parsed) throw new Error(`unparsed ${value}`);
  return parsed;
};

describe("parseColor", () => {
  it("reads oklch() as sRGB", () => {
    const red = c("oklch(0.62796 0.25768 29.234)");
    expect(red.r).toBeGreaterThan(254);
    expect(red.g).toBeLessThan(1);
    expect(red.b).toBeLessThan(1);
  });

  it.each([
    ["#fff", "#ffffff", 1],
    ["#138BC8", "#138bc8", 1],
    ["#138bc880", "#138bc8", 128 / 255],
    ["rgb(19,139,200)", "#138bc8", 1],
    ["rgba(19, 139, 200, 0.15)", "#138bc8", 0.15],
    ["rgb(19_139_200_/_40%)", "#138bc8", 0.4],
    ["white", "#ffffff", 1],
    /* Round 2's corpus wrote the brand blue as hsl() and oklch() and the scan
       could not read either. */
    ["hsl(0 100% 50%)", "#ff0000", 1],
    ["hsl(120, 100%, 25%)", "#008000", 1],
    ["hsla(240 100% 50% / 0.5)", "#0000ff", 0.5],
    ["hsl(200deg 100% 50%)", "#00aaff", 1],
    ["oklch(1 0 0)", "#ffffff", 1],
    ["oklch(0% 0 0 / 40%)", "#000000", 0.4],
  ])("%s", (input, hex, alpha) => {
    const parsed = c(input);
    expect(toHex(parsed)).toBe(hex);
    expect(parsed.a).toBeCloseTo(alpha, 3);
  });

  it.each([["var(--primary)"], ["12px"], ["url(x.png)"], ["#12345"]])(
    "is null for %s",
    (input) => {
      expect(parseColor(input)).toBeNull();
    },
  );
});

describe("contrast and compositing", () => {
  it("matches the WCAG reference pairs", () => {
    expect(contrast(c("#777777"), c("#ffffff"))).toBeCloseTo(4.48, 2);
    expect(contrast(c("#ffffff"), c("#138bc8"))).toBeCloseTo(3.78, 2);
    expect(contrast(c("#ffffff"), c("#1075a8"))).toBeCloseTo(5.08, 2);
  });

  it("lays a tint over a surface", () => {
    expect(toHex(over(c("rgba(19,139,200,0.15)"), c("#ffffff")))).toBe(
      "#dceef7",
    );
  });
});

describe("isBrandFamily", () => {
  it.each([
    ["#138bc8"],
    ["#0f7eb8"],
    ["#0a6d9e"],
    ["#1075a8"],
    ["#0c5f8a"],
    ["#30adec"],
    ["#0d5e87"],
    ["#175c89"],
  ])("includes %s", (hex) => {
    expect(isBrandFamily(c(hex))).toBe(true);
  });

  it.each([
    ["#002550", "the deepest navy surface"],
    ["#00204f", "the sidebar"],
    ["#85b7eb", "the pale status blue"],
    ["#06b6d4", "cyan"],
    ["#7c5cff", "violet"],
    ["#7c90a3", "muted grey-blue text"],
  ])("excludes %s (%s)", (hex) => {
    expect(isBrandFamily(c(hex))).toBe(false);
  });
});

describe("gradientSamples", () => {
  it("includes both ends and points between, in sRGB and oklab", () => {
    const samples = gradientSamples([c("#1075a8"), c("#6e4aff")]);
    expect(samples).toHaveLength(22);
    const worst = Math.min(...samples.map((s) => contrast(c("#ffffff"), s)));
    expect(worst).toBeGreaterThanOrEqual(4.5);
    expect(worst).toBeLessThan(contrast(c("#ffffff"), c("#6e4aff")));
  });
});
