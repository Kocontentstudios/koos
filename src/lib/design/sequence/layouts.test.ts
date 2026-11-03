import { describe, expect, it } from "vitest";
import { sameComposition } from "@/lib/jobs/directions/subject-layout";
import { beatOf } from "./fixtures";
import {
  isStatFigure,
  type LayoutSlot,
  settleFrameLayouts,
  withFigureLayout,
} from "./layouts";

const textLed = (n: number, layout: LayoutSlot["layout"] = "hero-center") =>
  Array.from({ length: n }, () => ({ layout, showsImage: false }));

const neighboursDiffer = (layouts: string[]) =>
  layouts.every((l, i) => i === 0 || !sameComposition(layouts[i - 1], l));

describe("isStatFigure", () => {
  it("is an amount, a share or a count", () => {
    for (const text of [
      "₦6,000,000",
      "$250,000 raise",
      "40% less waste",
      "120 students",
      "10 vans",
      "3x faster",
      "6k crates",
    ]) {
      expect(isStatFigure(text)).toBe(true);
    }
  });

  it("is not a code, a year, a clock time, a phone or a sentence", () => {
    for (const text of [
      "For SS3 students",
      "Since 2015",
      "Open 9am to 5pm",
      "Call 0803 555 0142",
      "Quality held by us, not a third party",
    ]) {
      expect(isStatFigure(text)).toBe(false);
    }
  });
});

describe("settleFrameLayouts", () => {
  it("never repeats a neighbour's composition", () => {
    const layouts = settleFrameLayouts(textLed(8, "quote-card"));
    expect(neighboursDiffer(layouts)).toBe(true);
  });

  it("cycles three compositions in a text-led deck, never alternating two", () => {
    const layouts = settleFrameLayouts(textLed(10), [], { panel: true });
    expect(neighboursDiffer(layouts)).toBe(true);
    for (let i = 2; i < layouts.length; i += 1) {
      expect(sameComposition(layouts[i - 2], layouts[i])).toBe(false);
    }
    expect(new Set(layouts).size).toBeGreaterThanOrEqual(3);
  });

  it("keeps a text-led carousel to the text-led layouts", () => {
    const layouts = settleFrameLayouts(textLed(6, "split-left"));
    expect(
      layouts.every((l) =>
        ["hero-center", "quote-card", "stat-highlight"].includes(l),
      ),
    ).toBe(true);
    expect(neighboursDiffer(layouts)).toBe(true);
  });

  it("sets stat-highlight only on a frame with a figure", () => {
    const slots = [
      { layout: "stat-highlight" as const, showsImage: false, figure: false },
      { layout: "hero-center" as const, showsImage: false },
      { layout: "stat-highlight" as const, showsImage: false, figure: true },
    ];
    expect(settleFrameLayouts(slots)).toEqual([
      "quote-card",
      "hero-center",
      "stat-highlight",
    ]);
  });

  it("keeps a proposal that already cycles", () => {
    const slots: LayoutSlot[] = [
      { layout: "banner-bottom", showsImage: true },
      { layout: "hero-center", showsImage: false },
      { layout: "split-left", showsImage: true },
    ];
    expect(settleFrameLayouts(slots)).toEqual([
      "banner-bottom",
      "hero-center",
      "split-left",
    ]);
  });
});

describe("withFigureLayout", () => {
  it("sets a stat-highlight headline with no stat as the centred card", () => {
    expect(
      withFigureLayout(
        beatOf({ layout: "stat-highlight", headline: "For SS3 students" }),
      ).layout,
    ).toBe("quote-card");
    expect(
      withFigureLayout(
        beatOf({ layout: "stat-highlight", headline: "120 students" }),
      ).layout,
    ).toBe("stat-highlight");
  });
});
