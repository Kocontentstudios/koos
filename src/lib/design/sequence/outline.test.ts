import { describe, expect, it } from "vitest";
import { sameComposition } from "@/lib/jobs/directions/subject-layout";
import { settleFrameLayouts } from "./layouts";
import { repeatedPoints, roleOf, settleOutline } from "./outline";
import type { OutlineAnswer } from "./schema";

type OutlineFrame = OutlineAnswer["frames"][number];

const frame = (over: Partial<OutlineFrame> = {}): OutlineFrame => ({
  beat: "detail",
  title: "A point",
  point: "Something the viewer learns",
  facts: [],
  layout: "hero-center",
  showsImage: false,
  ...over,
});

describe("roleOf", () => {
  it("is the frame's position", () => {
    expect([0, 1, 2, 3].map((i) => roleOf(i, 4))).toEqual([
      "hook",
      "body",
      "body",
      "cta",
    ]);
    expect([0, 1].map((i) => roleOf(i, 2))).toEqual(["hook", "cta"]);
  });
});

describe("settleOutline", () => {
  const options = {
    factCount: 4,
    offeringFact: 0,
    hasImage: true,
  };

  it("assigns roles by position whatever the model meant", () => {
    const settled = settleOutline(
      { frames: [frame(), frame(), frame()] },
      options,
    );
    expect(settled.frames.map((f) => f.role)).toEqual(["hook", "body", "cta"]);
  });

  it("puts the offering on the hook and every unplaced fact on the last frame", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ facts: [] }),
          frame({ facts: [2] }),
          frame({ facts: [9, 0, -1, 2] }),
        ],
      },
      options,
    );
    expect(settled.frames.map((f) => f.facts)).toEqual([[0], [1], [2, 3]]);
    expect(settled.factsPlaced).toEqual([2, 3]);
  });

  it("shows the image on the hook when the set has one", () => {
    const settled = settleOutline(
      { frames: [frame({ showsImage: false }), frame({ showsImage: true })] },
      options,
    );
    expect(settled.frames.map((f) => f.showsImage)).toEqual([true, true]);
  });

  it("shows no image anywhere when the set has none", () => {
    const settled = settleOutline(
      { frames: [frame({ showsImage: true }), frame({ showsImage: true })] },
      { ...options, hasImage: false },
    );
    expect(settled.frames.map((f) => f.showsImage)).toEqual([false, false]);
  });

  it("settles layouts and counts the changes", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ layout: "hero-center", showsImage: true }),
          frame({ layout: "hero-center" }),
          frame({ layout: "split-left", showsImage: false }),
        ],
      },
      options,
    );
    expect(settled.frames.map((f) => f.layout)).toEqual([
      "hero-center",
      "stat-highlight",
      "hero-center",
    ]);
    expect(settled.layoutsChanged).toBe(2);
  });
});

describe("settleFrameLayouts", () => {
  it("keeps a proposal that already varies", () => {
    expect(
      settleFrameLayouts([
        { layout: "banner-bottom", showsImage: true },
        { layout: "quote-card", showsImage: false },
        { layout: "split-left", showsImage: true },
      ]),
    ).toEqual(["banner-bottom", "quote-card", "split-left"]);
  });

  it("never puts a frame in its neighbour's composition", () => {
    const layouts = settleFrameLayouts(
      Array.from({ length: 10 }, () => ({
        layout: "quote-card" as const,
        showsImage: false,
      })),
    );
    for (let i = 1; i < layouts.length; i += 1) {
      expect(sameComposition(layouts[i - 1], layouts[i])).toBe(false);
    }
  });

  it("draws a frame without the image in a text-led layout", () => {
    expect(
      settleFrameLayouts([{ layout: "split-left", showsImage: false }]),
    ).toEqual(["hero-center"]);
  });

  it("steers a swap away from the brand's recent layouts", () => {
    expect(
      settleFrameLayouts(
        [
          { layout: "banner-bottom", showsImage: true },
          { layout: "banner-bottom", showsImage: true },
        ],
        ["hero-center", "split-left"],
      ),
    ).toEqual(["banner-bottom", "quote-card"]);
  });
});

describe("repeatedPoints", () => {
  it("names a point an earlier frame already made", () => {
    expect(
      repeatedPoints([
        { title: "The price", point: "A bottle costs ₦2,500" },
        { title: "Where", point: "Find us at the Yaba bar" },
        { title: "The cost", point: "A bottle costs ₦2,500 at launch" },
      ]),
    ).toEqual(["A bottle costs ₦2,500 at launch"]);
  });

  it("names a frame making the same kind of point as an earlier one", () => {
    expect(
      repeatedPoints([
        { beat: "proof", title: "Made by hand", point: "Dyed by hand" },
        { beat: "price", title: "The price", point: "₦18,000 a piece" },
        { beat: "proof", title: "The tradition", point: "Unchanged for years" },
      ]),
    ).toEqual(["Unchanged for years"]);
  });

  it("lets every point share the brand's and the offering's names", () => {
    const ignore = new Set(["cold", "brew"]);
    expect(
      repeatedPoints(
        [
          { title: "The launch", point: "Cold brew arrives" },
          { title: "The price", point: "Cold brew costs ₦2,500" },
        ],
        ignore,
      ),
    ).toEqual([]);
  });
});
