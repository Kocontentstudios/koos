// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DESKTOP_WIDTH,
  laneViewports,
  srcThresholds,
  thresholdsIn,
  uncoveredBands,
} from "./widths";

describe("thresholdsIn", () => {
  it("reads Tailwind breakpoints, max- forms and arbitrary values", () => {
    expect(
      thresholdsIn(
        `<span className="md:hidden max-lg:block min-[900px]:flex max-[1400px]:inline sm:px-2 hover:bg-x">`,
        false,
      ).sort((a, b) => a - b),
    ).toEqual([640, 768, 900, 1024, 1400]);
  });

  it("reads CSS media queries, where max-width holds up to and including N", () => {
    expect(
      thresholdsIn(
        "@media (max-width: 900px) { } @media (min-width: 40rem) { }",
        true,
      ),
    ).toEqual([901, 640]);
  });

  it("does not read a class that only ends like a breakpoint", () => {
    expect(thresholdsIn(`<p className="text-sm max-w-md">`, false)).toEqual([]);
  });
});

describe("laneViewports", () => {
  /* Round 3's v05 (md:hidden) and v06 (max-[1400px]:inline) were on screen
     only below 768 and below 1400, and the lane rendered only 1440. */
  it("renders a width in every band, so v05 and v06 are on screen", () => {
    const thresholds = [768, 1400];
    const widths = laneViewports(thresholds).map((v) => v.width);
    expect(uncoveredBands(thresholds, [...widths, DESKTOP_WIDTH])).toEqual([]);
    expect(widths.some((w) => w < 768)).toBe(true);
    expect(widths.some((w) => w >= 768 && w < 1400)).toBe(true);
  });

  it("covers every band the breakpoints in src make", () => {
    const thresholds = srcThresholds();
    const widths = [
      ...laneViewports(thresholds).map((v) => v.width),
      DESKTOP_WIDTH,
    ];
    expect(uncoveredBands(thresholds, widths)).toEqual([]);
  });

  it("finds an uncovered band", () => {
    expect(uncoveredBands([600, 700], [390, 1440])).toEqual([[600, 700]]);
  });

  it("opens disclosures on the phone and reduces motion at 1280", () => {
    const viewports = laneViewports([768]);
    expect(viewports.find((v) => v.disclosures)?.width).toBe(390);
    expect(viewports.find((v) => v.reducedMotion)?.width).toBe(1280);
  });
});

describe("selectedRoutes", () => {
  it("is every route by default and the named ones otherwise", async () => {
    const { ROUTES, selectedRoutes } = await import("./routes");
    expect(selectedRoutes("")).toBe(ROUTES);
    expect(selectedRoutes("team, brand").map((r) => r.label)).toEqual([
      "brand",
      "team",
    ]);
    expect(() => selectedRoutes("team,nope")).toThrow("nope");
  });
});
