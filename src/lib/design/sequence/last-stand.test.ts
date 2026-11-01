import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import type { FrameBeat, PlannedSequence } from "./contract";
import { blockingFaults, type FaultRules, setFaults } from "./faults";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
  fact,
  LUMEN_BRIEF,
} from "./fixtures";
import { lastStand, promotableOntoHook, rulesWithout } from "./last-stand";

/* Rubric Addendum C, C1: a blocking fault the repairs leave is cleared by
   a sourced point in the frame's place, or the frame off the set; never
   shipped. */

const SPARE = "Every bottle is steeped for 18 hours in cold water";
/* An approved point the set says nowhere once the bare third frame gives
   it up: only "patience" is on the set, a quarter of its words. */
const APPROVED_POINT = "Patience is the whole recipe, nothing rushed";

/* A four-frame cafe set whose third frame says nothing under its
   headline: a blocking fault on a frame that carries no fact. */
function withBareFrame(): PlannedSequence {
  const cafe = cafePlan().frames;
  return {
    ...cafePlan(),
    frames: [
      cafe[0],
      cafe[3],
      beatOf({
        title: "Patience in every glass",
        headline: "Patience in every glass",
        subheadline: "",
      }),
      {
        ...cafe[4],
        footerLines: [
          "₦2,500 a bottle",
          "Saturday 15 November, 8am to 2pm",
          "WhatsApp 0803 555 0142",
        ],
      },
    ],
  };
}

const rulesFor = (
  frames: number,
  over: Partial<FaultRules> = {},
): FaultRules => ({
  frameCount: frames,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: [],
  ledger: factLedger([CAFE_BRIEF, SPARE, "Patience in every glass"], 2),
  owners: [[0], [4], [], [1, 2, 3, 5]],
  claims: ["", "Pour one at our Yaba bar", "Patience in every glass", ""],
  ...over,
});

const blockingOn = (plan: PlannedSequence, rules: FaultRules) =>
  blockingFaults(setFaults(plan, rules)).map((f) => f.frame);

describe("lastStand", () => {
  it("starts from a set whose third frame alone blocks", () => {
    expect(blockingOn(withBareFrame(), rulesFor(4))).toEqual([2]);
  });

  it("gives the frame a sourced spare point in its place", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [SPARE],
    });
    expect(result.blocking).toEqual([]);
    expect(result.dropped).toEqual([]);
    expect(result.plan.frames).toHaveLength(4);
    expect(result.claims[2]).toBe(SPARE);
    expect(result.plan.frames[2].subheadline).toBe(`${SPARE}.`);
    expect(result.applied[0]).toMatch(/^frame 3: given the spare point/);
  });

  it("drops the frame when no spare is left, and reports it", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [],
    });
    expect(result.blocking).toEqual([]);
    expect(result.dropped).toEqual([2]);
    expect(result.kept).toEqual([0, 1, 3]);
    expect(result.plan.frames).toHaveLength(3);
    expect(result.rules.frameCount).toBe(3);
    expect(result.plan.frames.at(-1)?.role).toBe("cta");
  });

  it("neither swaps nor drops the owner's own point, and leaves its fault to refuse", () => {
    const rules = rulesFor(4, {
      owned: ["", "", "Patience in every glass", ""],
    });
    const result = lastStand({
      plan: withBareFrame(),
      rules,
      claims: rules.claims ?? [],
      spares: [SPARE],
    });
    expect(result.claims).not.toContain(SPARE);
    expect(result.dropped).toEqual([]);
    expect(result.plan.frames).toHaveLength(4);
    expect(result.blocking.map((f) => f.frame)).toEqual([2]);
  });

  it("never drops a frame whose point the owner edited, though its words read as the brief's", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [SPARE],
      ownerWritten: [false, false, true, false],
    });
    expect(result.dropped).toEqual([]);
    expect(result.claims).not.toContain(SPARE);
    expect(result.plan.frames[2].headline).toBe("Patience in every glass");
    expect(result.blocking.map((f) => f.frame)).toEqual([2]);
  });

  it("keeps an approved point's frame when dropping it would leave the point unsaid", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [],
      approved: ["", "", APPROVED_POINT, ""],
    });
    expect(result.dropped).toEqual([]);
    expect(result.plan.frames).toHaveLength(4);
  });

  it("never swaps an approved point away for a spare the set does not otherwise make", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [SPARE],
      approved: ["", "", APPROVED_POINT, ""],
    });
    expect(result.claims).not.toContain(SPARE);
    expect(result.dropped).toEqual([]);
  });

  it("drops an approved point's frame when another frame still says it", () => {
    const result = lastStand({
      plan: withBareFrame(),
      rules: rulesFor(4),
      claims: rulesFor(4).claims ?? [],
      spares: [],
      approved: ["", "", "₦2,500 a bottle", ""],
    });
    expect(result.dropped).toEqual([2]);
    expect(result.blocking).toEqual([]);
  });

  it("never takes a set below its bounds, and leaves the fault to refuse", () => {
    const plan: PlannedSequence = {
      ...cafePlan(),
      kind: "presentation",
      aspectRatio: "16:9",
      frames: [
        cafePlan().frames[0],
        beatOf({
          title: "Patience in every glass",
          headline: "Patience in every glass",
        }),
        withBareFrame().frames[3],
      ],
    };
    const rules = rulesFor(3, {
      owners: [[0], [], [1, 2, 3, 4, 5]],
      claims: ["", "Patience in every glass", ""],
    });
    const result = lastStand({ plan, rules, claims: [], spares: [] });
    expect(result.dropped).toEqual([]);
    expect(result.blocking.length).toBeGreaterThan(0);
  });
});

describe("lastStand: a hook no spare can fix", () => {
  it("takes a later frame's line as its headline over its own point, and drops that frame", () => {
    const cafe = withBareFrame().frames;
    const plan: PlannedSequence = {
      ...cafePlan(),
      frames: [
        {
          ...cafe[0],
          headline: "Kiln Coffee cold brew is back",
          subheadline: "Our cold brew is on the bar again.",
        },
        cafe[1],
        beatOf({
          title: "Steeped 18 hours",
          headline: "Steeped for 18 hours in cold water",
          subheadline: "No heat touches it, so every glass stays smooth.",
          layout: "quote-card",
        }),
        cafe[3],
      ],
    };
    const hookPoint =
      "Kiln Coffee cold brew, slow-steeped and poured over ice.";
    const rules = rulesFor(4, {
      names: ["cold brew"],
      ledger: factLedger(
        [
          CAFE_BRIEF,
          hookPoint,
          "Steeped for 18 hours in cold water. No heat touches it, so every glass stays smooth.",
          "Our cold brew is on the bar again.",
        ],
        4,
      ),
      owners: [[0], [4], [], [1, 2, 3, 5]],
      claims: [
        hookPoint,
        "Pour one at our Yaba bar",
        "Steeped for 18 hours in cold water",
        "",
      ],
    });
    expect(blockingOn(plan, rules)).toContain(0);
    const result = lastStand({
      plan,
      rules,
      claims: rules.claims ?? [],
      spares: [],
    });
    expect(result.blocking).toEqual([]);
    expect(result.dropped).toEqual([1]);
    expect(result.promoted).toEqual([1]);
    expect(result.plan.frames[0].headline).toBe("Pour one at our Yaba bar");
    expect(result.plan.frames[0].subheadline).toBe(hookPoint);
    expect(result.rules.owners?.[0]).toEqual([0, 4]);
    expect(result.applied[0]).toMatch(/made the hook's headline/);
  });

  it("leaves an owner-written hook as it is, and an owner-written body frame in the set", () => {
    const cafe = withBareFrame().frames;
    const plan: PlannedSequence = {
      ...cafePlan(),
      frames: [
        {
          ...cafe[0],
          headline: "Kiln Coffee cold brew is back",
          subheadline: "Our cold brew is on the bar again.",
        },
        cafe[1],
        cafe[3],
      ],
    };
    const rules = rulesFor(3, {
      names: ["cold brew"],
      owners: [[0], [4], [1, 2, 3, 5]],
      claims: ["", "Pour one at our Yaba bar", ""],
    });
    expect(blockingOn(plan, rules)).toContain(0);
    for (const ownerWritten of [
      [true, false, false],
      [false, true, false],
    ]) {
      const result = lastStand({
        plan,
        rules,
        claims: rules.claims ?? [],
        spares: [],
        ownerWritten,
      });
      expect(result.dropped).toEqual([]);
      if (ownerWritten[0]) {
        expect(result.plan.frames[0].headline).toBe(
          "Kiln Coffee cold brew is back",
        );
      }
    }
  });
});

describe("rulesWithout", () => {
  it("moves every per-frame rule up one and gives the action the frame's facts", () => {
    const rules = rulesFor(6, {
      owners: [[0], [1], [2], [3], [4], [5]],
      claims: ["", "", "", "", "gone", ""],
      owned: ["", "", "", "", "mine", ""],
      flagged: [
        { kind: "repeat", frame: 5, sameAs: 3, headline: "x" },
        { kind: "repeat", frame: 4, sameAs: 1, headline: "y" },
        { kind: "unsourced", frame: 2, text: "z" },
      ],
      held: [{ text: "a held point", frames: [0, 4, 5] }],
    });
    const next = rulesWithout(rules, 4);
    expect(next.frameCount).toBe(5);
    expect(next.owners).toEqual([[0], [1], [2], [3], [5, 4]]);
    expect(next.claims).toEqual(["", "", "", "", ""]);
    expect(next.owned).toEqual(["", "", "", "", ""]);
    expect(next.flagged).toEqual([
      { kind: "repeat", frame: 4, sameAs: 3, headline: "x" },
      { kind: "unsourced", frame: 2, text: "z" },
    ]);
    expect(next.held).toEqual([{ text: "a held point", frames: [0, 4] }]);
  });
});

/* Integration round 2, HIGH 1, the critic's own set: the hook still
   blocked, the stand took slide 3's line ("Audience: young professionals
   in Yaba", the brief's note to the designer) as the hook's headline and
   dropped slide 3, and the set view said slide 3 "couldn't be worded". */
describe("lastStand: a line that cannot open the set never becomes the hook", () => {
  const LUMEN_FACTS = [
    fact("product", "Lumen Cold Brew"),
    fact("date", "Saturday 14 November"),
    fact("place", "our Yaba shop (12 Herbert Macaulay Way)"),
    fact("price", "N3,500"),
    fact("contact", "WhatsApp 0812 555 0199"),
  ];
  const hookPoint =
    "Lumen Cold Brew is steeped for 20 hours from single-origin Ethiopian beans.";
  const lumenPlan = (third: Partial<FrameBeat>): PlannedSequence => ({
    ...cafePlan(),
    frames: [
      beatOf({
        role: "hook",
        title: "Lumen Cold Brew",
        headline: "Lumen Cold Brew is here",
        subheadline: "Our cold brew lands at the Yaba shop on Saturday.",
        layout: "banner-bottom",
        showsImage: true,
      }),
      beatOf({
        title: "Launch day pastry",
        headline: "Buy two, get a free pastry",
        subheadline: "The pastry comes free on launch day only.",
        layout: "split-left",
      }),
      beatOf({
        title: "Young professionals in Yaba",
        headline: "Audience: young professionals in Yaba",
        subheadline: "Lumen Cold Brew is smooth and low in acid.",
        ...third,
      }),
      beatOf({
        role: "cta",
        title: "Order ahead",
        headline: "Order ahead for Saturday 14 November",
        cta: "Order on WhatsApp",
        footerLines: [
          "N3,500 a bottle",
          "our Yaba shop (12 Herbert Macaulay Way)",
          "WhatsApp 0812 555 0199",
        ],
        layout: "quote-card",
      }),
    ],
  });
  const lumenRules = (claims: string[]): FaultRules => ({
    frameCount: 4,
    facts: LUMEN_FACTS,
    offering: "Lumen Cold Brew",
    hasImage: true,
    brandName: "Lumen Coffee",
    names: [],
    ledger: factLedger([LUMEN_BRIEF], 1),
    owners: [[0], [], [], [1, 2, 3, 4]],
    claims,
    briefText: LUMEN_BRIEF,
  });
  const claims = [
    hookPoint,
    "Launch day only: buy two, get a free pastry.",
    "Audience: young professionals in Yaba and Surulere who want a smooth",
    "",
  ];

  it("starts from a hook that blocks", () => {
    expect(blockingOn(lumenPlan({}), lumenRules(claims))).toContain(0);
  });

  it("never puts the brief's note to the designer on the hook", () => {
    /* The owner wrote slide 2, so slide 3 is the only body frame the
       stand may take off: the live run's position. */
    const result = lastStand({
      plan: lumenPlan({}),
      rules: lumenRules(claims),
      claims,
      spares: [],
      sourceText: LUMEN_BRIEF,
      ownerWritten: [false, true, false, false],
    });
    const hook = result.plan.frames[0];
    expect(hook.headline).not.toMatch(/audience|young professionals/i);
    for (const what of result.applied) {
      expect(what).not.toMatch(/^frame 3: its line made the hook's headline/);
    }
    for (const beat of result.plan.frames) {
      expect(beat.headline).not.toMatch(/^Audience:/);
    }
    expect(result.dropped).toContain(2);
    expect(result.promoted).toEqual([]);
  });
});

describe("promotableOntoHook", () => {
  const rules = {
    offering: "Lumen Cold Brew",
    names: [],
    brandName: "Lumen Coffee",
    facts: [],
  };
  const hook = (headline: string) =>
    beatOf({
      role: "hook",
      headline,
      subheadline:
        "Lumen Cold Brew pours low in acid, straight from the bottle.",
    });

  it.each([
    [
      "the brief's note to the designer",
      "Audience: young professionals in Yaba",
    ],
    ["a fragment", "Who want a smooth"],
    ["the piece's own lead", "A short deck for office managers in Lagos"],
    ["an announcement", "Lumen Cold Brew is here"],
  ])("refuses %s", (_, headline) => {
    expect(promotableOntoHook(hook(headline), rules)).toBe(false);
  });

  it("refuses a hook that no longer names the offering", () => {
    expect(
      promotableOntoHook(
        beatOf({
          role: "hook",
          headline: "Steeped 20 hours, so every sip stays smooth",
          subheadline: "No heat touches the beans.",
        }),
        rules,
      ),
    ).toBe(false);
  });

  it("takes a concrete line over a subheadline that names the offering", () => {
    expect(
      promotableOntoHook(
        hook("Steeped 20 hours, so every sip stays smooth"),
        rules,
      ),
    ).toBe(true);
  });
});
