import { describe, expect, it } from "vitest";
import { sameComposition } from "@/lib/jobs/directions/subject-layout";
import { settleFrameLayouts } from "./layouts";
import { homeFor, repeatedPoints, roleOf, settleOutline } from "./outline";
import type { OutlineAnswer } from "./schema";

type OutlineFrame = OutlineAnswer["frames"][number];

const frame = (over: Partial<OutlineFrame> = {}): OutlineFrame => ({
  beat: "detail",
  title: "A point",
  point: "Something the viewer learns",
  facts: [],
  profilePoint: 0,
  briefPoint: 0,
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

  it("gives an unplaced fact the body frame it is the point of, else one that states nothing, before the last", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ beat: "promise" }),
          frame({ beat: "proof", facts: [2] }),
          frame({ beat: "price" }),
          frame({ beat: "detail" }),
          frame({ beat: "action" }),
        ],
      },
      {
        ...options,
        factCount: 5,
        factKinds: ["product", "place", "price", "contact", "age"],
      },
    );
    expect(settled.frames.map((f) => f.facts)).toEqual([
      [0],
      [1],
      [2],
      [4],
      [3],
    ]);
    expect(settled.factsPlaced).toEqual([2, 3, 4]);
  });

  it("falls back to the last frame only when every body frame has its own fact", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ beat: "promise" }),
          frame({ beat: "proof", facts: [2] }),
          frame({ beat: "action" }),
        ],
      },
      { ...options, factCount: 3, factKinds: ["product", "place", "time"] },
    );
    expect(settled.frames.map((f) => f.facts)).toEqual([[0], [1], [2]]);
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
      "quote-card",
      "hero-center",
    ]);
    expect(settled.layoutsChanged).toBe(2);
  });

  it("sets stat-highlight only on a frame that states a figure (round-3 critic, finding 4)", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ layout: "hero-center" }),
          frame({ layout: "stat-highlight", facts: [3] }),
          frame({ layout: "hero-center" }),
          frame({ layout: "stat-highlight" }),
        ],
      },
      {
        ...options,
        hasImage: false,
        offeringFact: null,
        factTexts: ["cold brew", "our Yaba bar", "₦2,500 a bottle", "Saturday"],
      },
    );
    expect(settled.frames.map((f) => f.layout)).toEqual([
      "hero-center",
      "stat-highlight",
      "hero-center",
      "quote-card",
    ]);
  });

  it("makes each brand-profile point once, on a middle frame only", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ profilePoint: 1 }),
          frame({ profilePoint: 1 }),
          frame({ profilePoint: 1, point: "The same point again" }),
          frame({ profilePoint: 2 }),
          frame({ profilePoint: 2 }),
        ],
      },
      { ...options, profilePointCount: 2 },
    );
    expect(settled.frames.map((f) => f.profilePoint)).toEqual([
      null,
      0,
      null,
      1,
      null,
    ]);
    expect(settled.profileReused).toEqual([2]);
  });

  it("drops a profile point the outline was never offered", () => {
    const settled = settleOutline(
      { frames: [frame(), frame({ profilePoint: 3 }), frame()] },
      { ...options, profilePointCount: 2 },
    );
    expect(settled.frames[1].profilePoint).toBeNull();
    expect(settled.profileReused).toEqual([]);
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

  it("cycles a text-led set through three layouts when frames have figures, not one pair", () => {
    const layouts = settleFrameLayouts(
      Array.from({ length: 6 }, () => ({
        layout: "quote-card" as const,
        showsImage: false,
        figure: true,
      })),
    );
    expect(layouts).toEqual([
      "quote-card",
      "hero-center",
      "stat-highlight",
      "hero-center",
      "quote-card",
      "hero-center",
    ]);
    for (let i = 1; i < layouts.length; i += 1) {
      expect(sameComposition(layouts[i - 1], layouts[i])).toBe(false);
    }
  });

  it("never sets stat-highlight on a frame with no figure", () => {
    const layouts = settleFrameLayouts(
      Array.from({ length: 8 }, (_, i) => ({
        layout: i % 2 ? ("stat-highlight" as const) : ("hero-center" as const),
        showsImage: i === 0,
      })),
    );
    expect(layouts).not.toContain("stat-highlight");
    expect(layouts[1]).toBe("quote-card");
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

describe("homeFor", () => {
  const frames = [
    { role: "hook" as const, beat: "promise" as const, facts: [0] },
    { role: "body" as const, beat: "proof" as const, facts: [1] },
    { role: "body" as const, beat: "when-where" as const, facts: [2] },
    { role: "body" as const, beat: "detail" as const, facts: [] },
    { role: "cta" as const, beat: "action" as const, facts: [] },
  ];

  it("sends a contact to the action", () => {
    expect(homeFor(frames, "contact")).toBe(4);
  });

  it("sends a fact to the frame whose beat it is, even one that has facts", () => {
    expect(homeFor(frames, "time")).toBe(2);
  });

  it("sends a fact with no beat of its own to an empty body frame", () => {
    expect(homeFor(frames, "price")).toBe(3);
  });

  it("never sends one to the hook", () => {
    expect(homeFor(frames.slice(0, 1).concat(frames.slice(4)), "price")).toBe(
      1,
    );
  });
});

describe("settleOutline: a carousel's price", () => {
  /* 0 the offering, 1 a price, 2 a date, 3 a contact. */
  const kinds = ["product", "price", "date", "contact"] as const;
  const options = {
    factCount: 4,
    offeringFact: 0,
    hasImage: false,
    factKinds: [...kinds],
  };
  /* Fact numbers in an answer are 1-based, as the prompt lists them. */
  const answer = {
    frames: [
      frame(),
      frame({ beat: "detail", facts: [2] }),
      frame({ beat: "when-where", facts: [3] }),
      frame({ beat: "action", facts: [4] }),
    ],
  };

  it("moves every price to the action frame, beside how to act", () => {
    const settled = settleOutline(answer, {
      ...options,
      priceWithAction: true,
    });
    expect(settled.frames.map((f) => f.facts)).toEqual([[0], [], [2], [3, 1]]);
  });

  it("places an unplaced price there too, never on a middle frame", () => {
    const settled = settleOutline(
      { frames: answer.frames.map((f) => ({ ...f, facts: [] })) },
      { ...options, priceWithAction: true },
    );
    expect(settled.frames[3].facts).toContain(1);
    expect(settled.frames.slice(1, 3).flatMap((f) => f.facts)).not.toContain(1);
  });

  it("leaves a deck's price where the outline put it", () => {
    const settled = settleOutline(answer, options);
    expect(settled.frames[1].facts).toEqual([1]);
  });
});

describe("settleOutline: where and when on a carousel hook", () => {
  /* 0 the offering, 1 a place, 2 a date, 3 a count, 4 a contact. */
  const kinds = ["product", "place", "date", "quantity", "contact"] as const;
  const options = {
    factCount: 5,
    offeringFact: 0,
    hasImage: false,
    factKinds: [...kinds],
  };
  const answer = {
    frames: [
      frame({ facts: [2, 3, 4, 5] }),
      frame({ beat: "when-where" }),
      frame({ beat: "proof" }),
      frame({ beat: "action" }),
    ],
  };

  it('takes the place, date and contact off the hook (round-4 critic: "Cold brew at our Yaba bar")', () => {
    const settled = settleOutline(answer, {
      ...options,
      whereWhenOffHook: true,
    });
    expect(settled.frames[0].facts).toEqual([0, 3]);
    expect(settled.frames[1].facts).toEqual([1, 2]);
    expect(settled.frames[3].facts).toEqual([4]);
  });

  it("leaves a deck's title slide its date and venue, and a two-frame set its hook", () => {
    expect(settleOutline(answer, options).frames[0].facts).toEqual([
      0, 1, 2, 3, 4,
    ]);
    const two = settleOutline(
      { frames: [frame({ facts: [2] }), frame({ facts: [5] })] },
      { ...options, whereWhenOffHook: true },
    );
    expect(two.frames[0].facts).toContain(1);
  });
});

describe("settleOutline: every middle frame on a source of its own", () => {
  const options = {
    factCount: 2,
    offeringFact: 0,
    hasImage: false,
    briefPointCount: 2,
    profilePointCount: 1,
  };

  it("keeps each brief point's first citation and names the frame that cites it again", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ briefPoint: 1 }),
          frame({ beat: "proof", briefPoint: 1 }),
          frame({ beat: "benefit", briefPoint: 2 }),
          frame({ beat: "action", facts: [2] }),
        ],
      },
      options,
    );
    expect(settled.frames.map((f) => f.briefPoint)).toEqual([0, null, 1, null]);
    expect(settled.briefReused).toEqual([1]);
  });

  it("names a middle frame built on nothing while a source is left (round-4 critic, LOW 8)", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ briefPoint: 1 }),
          frame({ beat: "proof" }),
          frame({ beat: "benefit", profilePoint: 1 }),
          frame({ beat: "action", facts: [2] }),
        ],
      },
      options,
    );
    expect(settled.unsourced).toEqual([1]);
  });

  it("names none once every source is spent", () => {
    const settled = settleOutline(
      {
        frames: [
          frame({ briefPoint: 1 }),
          frame({ beat: "proof", briefPoint: 2 }),
          frame({ beat: "benefit", profilePoint: 1 }),
          frame({ beat: "audience" }),
          frame({ beat: "action", facts: [2] }),
        ],
      },
      options,
    );
    expect(settled.unsourced).toEqual([]);
  });
});
