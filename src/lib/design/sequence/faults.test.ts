import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import {
  actionRecaps,
  bareNameSubheadlines,
  blockingFaults,
  COVERAGE,
  contactOnHook,
  type FaultRules,
  faultScore,
  flaggedFaults,
  headlineGrammar,
  headlinePrices,
  hookScore,
  MAJOR,
  pointRepeats,
  restatesHeadline,
  selfReferences,
  setFaults,
  subheadlineGrammar,
  titleFaults,
} from "./faults";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
  fact,
  withFrame,
} from "./fixtures";
import { namesFree } from "./hook";

const rules: FaultRules = {
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([CAFE_BRIEF, "Kiln Coffee"], 1),
};

describe("subheadlineGrammar", () => {
  it("finds a subheadline split off its subject", () => {
    expect(
      subheadlineGrammar(
        "is fully allocated to expanding cold-chain coverage.",
      ),
    ).toMatch(/starts mid-sentence/);
    expect(
      subheadlineGrammar("Is fully allocated to expanding coverage."),
    ).toMatch(/has no subject/);
  });

  it("passes a whole sentence and an empty field", () => {
    expect(
      subheadlineGrammar("The raise buys ten vans for the cold chain."),
    ).toBeNull();
    expect(subheadlineGrammar("")).toBeNull();
  });
});

describe("titleFaults", () => {
  it("finds two frames under one title in any casing", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, { title: "Cold-Chain Advantage" }),
      3,
      { title: "Cold-chain advantage" },
    );
    expect(titleFaults(plan.frames, [])).toContainEqual(
      expect.objectContaining({
        frame: 3,
        field: "title",
        weight: MAJOR,
        detail: expect.stringMatching(/an earlier frame's title/),
      }),
    );
  });

  it("finds a title cut from the brief and a placeholder", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, { title: "Steeped for eighteen" }),
      4,
      { title: "How to act" },
    );
    const faults = titleFaults(plan.frames, [
      "Steeped for eighteen hours, served over ice",
    ]);
    expect(faults.find((f) => f.frame === 1)?.detail).toMatch(/cut off/);
    expect(faults.find((f) => f.frame === 4)?.detail).toMatch(/placeholder/);
  });
});

describe("flaggedFaults", () => {
  it("holds a repeat until the later frame is rewritten", () => {
    const plan = cafePlan();
    const flag = {
      kind: "repeat" as const,
      frame: 3,
      sameAs: 1,
      headline: plan.frames[3].headline,
    };
    expect(flaggedFaults(plan.frames, [flag])).toEqual([
      expect.objectContaining({
        frame: 3,
        field: "headline",
        weight: MAJOR,
        detail: expect.stringMatching(/makes frame 2's point/),
      }),
    ]);
    const rewritten = withFrame(plan, 3, { headline: "Another point" });
    expect(flaggedFaults(rewritten.frames, [flag])).toEqual([]);
  });

  it("holds an unsourced statement until its words are gone", () => {
    const plan = withFrame(cafePlan(), 2, {
      subheadline: "Walk in any time. No appointment needed.",
    });
    const flag = {
      kind: "unsourced" as const,
      frame: 2,
      text: "No appointment needed",
    };
    expect(flaggedFaults(plan.frames, [flag])).toHaveLength(1);
    const cut = withFrame(plan, 2, { subheadline: "Walk in any time." });
    expect(flaggedFaults(cut.frames, [flag])).toEqual([]);
  });
});

describe("selfReferences", () => {
  it("finds copy about the set itself", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "This investor deck covers the round.",
    });
    expect(selfReferences(plan.frames)).toEqual([
      expect.objectContaining({ frame: 0, field: "subheadline" }),
    ]);
  });

  it("leaves copy about the offering alone", () => {
    expect(selfReferences(cafePlan().frames)).toEqual([]);
  });
});

describe("pointRepeats", () => {
  it("finds a headline that makes an earlier frame's point under another title", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        title: "Who owns it",
        headline: "Quality held by us, not a third party",
        subheadline: "Every van is ours, cold chain and all",
      }),
      3,
      {
        title: "The vans",
        headline: "We own every cold-chain van",
        subheadline: "",
      },
    );
    expect(pointRepeats(plan.frames, CAFE_FACTS, new Set())).toEqual([
      expect.objectContaining({ frame: 3, field: "headline" }),
    ]);
  });

  it("passes frames that make different points", () => {
    expect(pointRepeats(cafePlan().frames, CAFE_FACTS, new Set())).toEqual([]);
  });
});

describe("headlinePrices", () => {
  it("finds a carousel's price in a headline before the action frame", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "₦2,500 for slow cold brew",
    });
    const found = headlinePrices(plan.frames, CAFE_FACTS, "carousel");
    expect(found.map((f) => f.frame)).toEqual([0, 1]);
    expect(found[0].weight).toBe(MAJOR);
  });

  it("leaves a deck's price where it is", () => {
    expect(
      headlinePrices(cafePlan().frames, CAFE_FACTS, "presentation"),
    ).toEqual([]);
  });
});

describe("setFaults", () => {
  it("weighs a missing fact as coverage, owned by the frame meant to state it", () => {
    const plan = withFrame(cafePlan(), 4, { footerLines: [] });
    const faults = setFaults(plan, {
      ...rules,
      owners: [[0], [1], [2, 3], [4], [5]],
    });
    expect(faults).toContainEqual(
      expect.objectContaining({ frame: 4, weight: COVERAGE }),
    );
  });

  it("blocks a fragment subheadline, a duplicate title and an announcing hook", () => {
    let plan = withFrame(cafePlan(), 0, { headline: "Cold brew is here" });
    plan = withFrame(plan, 3, {
      title: "The launch",
      subheadline: "is poured over ice every morning.",
    });
    const blocking = blockingFaults(setFaults(plan, rules));
    const fields = blocking.map((f) => `${f.frame}:${f.field}`);
    expect(fields).toEqual(
      expect.arrayContaining(["0:headline", "3:subheadline", "3:title"]),
    );
  });

  it("scores a clean set below the same set with a repeat", () => {
    const clean = faultScore(setFaults(cafePlan(), rules));
    const repeated = faultScore(
      setFaults(
        withFrame(cafePlan(), 3, { headline: "Your Saturday, slowed down" }),
        rules,
      ),
    );
    expect(repeated).toBeGreaterThan(clean);
  });
});

describe("hookScore", () => {
  it("prefers an opening that names the offering and gives a reason over an announcement", () => {
    const plan = cafePlan();
    const flat = hookScore(
      { ...plan.frames[0], headline: "Cold brew is here", subheadline: "" },
      plan,
      rules,
    );
    const strong = hookScore(plan.frames[0], plan, rules);
    expect(strong).toBeLessThan(flat);
  });
});

describe("headlineGrammar", () => {
  it.each([
    "for Year 6 pupils",
    "For Year 6 pupils",
    "With our head tailor",
    "and every week after",
  ])("refuses %j as a headline of its own", (headline) => {
    expect(headlineGrammar(headline)).not.toBeNull();
  });

  it.each([
    "For students who mark their own papers weekly",
    "Taught by teachers who mark the exam",
    "Year 6 pupils sit six mock papers",
    "15 seats per cohort",
  ])("passes %j", (headline) => {
    expect(headlineGrammar(headline)).toBeNull();
  });
});

/* Shipped on delivered sets: a hook subheadline cut mid-sentence, and
   subheadlines that were only the brand's name. */
describe("lines cut before their object, and subheadlines of names alone", () => {
  it.each([
    "Ironclad Gym's monthly membership includes",
    "Every session comes with",
    "Your membership offers.",
  ])("finds the cut subheadline %j", (text) => {
    expect(subheadlineGrammar(text)).toMatch(/stops before what it names/);
  });

  it("finds a cut headline and leaves whole lines alone", () => {
    expect(headlineGrammar("Membership includes")).toMatch(/stops before/);
    expect(headlineGrammar("A sauna is included")).toBeNull();
    expect(
      subheadlineGrammar("Free towels and a sauna come with it."),
    ).toBeNull();
  });

  it.each([
    ["FreshFold.", "FreshFold", "laundry pickup"],
    ["Fixit Hub.", "Fixit Hub", null],
    ["Alterations from Stitchwell.", "Stitchwell", "alterations"],
  ] as const)("finds the bare-name subheadline %j", (text, brand, offering) => {
    const faults = bareNameSubheadlines(
      [
        beatOf({
          role: "hook",
          headline: "Back by Wednesday",
          subheadline: text,
        }),
      ],
      namesFree(brand, offering),
    );
    expect(faults).toHaveLength(1);
    expect(faults[0].weight).toBe(MAJOR);
  });

  it("leaves a subheadline that says something about the name", () => {
    expect(
      bareNameSubheadlines(
        [beatOf({ subheadline: "FreshFold irons every shirt by hand." })],
        namesFree("FreshFold", "laundry pickup"),
      ),
    ).toEqual([]);
  });
});

describe("contactOnHook", () => {
  it("finds the hook spending its line on how to act", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "WhatsApp 0803 555 0142 to reserve.",
    });
    expect(contactOnHook(plan.frames, CAFE_FACTS)).toEqual([
      expect.objectContaining({
        frame: 0,
        field: "subheadline",
        weight: MAJOR,
      }),
    ]);
    expect(contactOnHook(cafePlan().frames, CAFE_FACTS)).toEqual([]);
  });
});

describe("selfReferences on a deck naming its own kind", () => {
  it("finds a hook calling itself a fundraising deck", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "Fundraising deck for Ikorodu Code Club.",
    });
    expect(selfReferences(plan.frames)).toHaveLength(1);
  });
});

describe("setFaults: a price mid-story", () => {
  const midPrice = () =>
    withFrame(cafePlan(), 3, {
      subheadline: "Sit in with a glass for ₦2,500 a bottle.",
    });

  it("blocks a carousel body frame that drops the price before the action", () => {
    const found = setFaults(midPrice(), rules).filter(
      (f) => f.frame === 3 && /gives the price/.test(f.detail),
    );
    expect(found.map((f) => f.weight)).toContain(MAJOR);
  });

  it("lets the owner's own point carry its price", () => {
    const owned = ["", "", "", "A glass costs ₦2,500 a bottle", ""];
    const found = setFaults(midPrice(), { ...rules, owned }).filter(
      (f) => f.frame === 3 && /gives the price/.test(f.detail),
    );
    expect(found.every((f) => f.weight < MAJOR)).toBe(true);
  });
});

describe("actionRecaps: the close says how to act, not a middle frame again", () => {
  const offer = fact("offer", "Free for your first 3 months");
  const frames = [
    beatOf({ role: "hook", headline: "Invoice in under a minute" }),
    beatOf({ headline: "Free for your first 3 months, no card" }),
    beatOf({ headline: "Reminders go out on time" }),
    beatOf({ role: "cta", headline: "Free for your first 3 months" }),
  ];

  it("names an action headline that leads on a middle frame's offer, as minor", () => {
    const [fault] = actionRecaps(frames, [offer]);
    expect(fault).toMatchObject({ frame: 3, field: "headline" });
    expect(fault.detail).toContain("frame 2");
    expect(blockingFaults([fault])).toEqual([]);
  });

  it("lets the action give the price, the place and the contact again", () => {
    const price = fact("price", "₦3,500 a jar");
    const priced = frames.map((b, i) =>
      i === 1 || i === 3 ? { ...b, headline: "Yours for ₦3,500 a jar" } : b,
    );
    expect(actionRecaps(priced, [price])).toEqual([]);
  });
});

describe("an article left without its noun", () => {
  it("is a broken line in a subheadline or a headline", () => {
    expect(
      subheadlineGrammar(
        "Weekday bookings come with a added to your silk press appointment.",
      ),
    ).toMatch(/stops before/);
    expect(headlineGrammar("Weekday bookings get a")).toMatch(/stops before/);
    expect(headlineGrammar("Weekday bookings get")).toMatch(/stops before/);
  });

  it("leaves a letter that names a grade or a round alone", () => {
    expect(headlineGrammar("Closing our Series A")).toBeNull();
    expect(
      subheadlineGrammar("Each room keeps a crate cool for 3 weeks."),
    ).toBeNull();
    expect(
      subheadlineGrammar("A free scalp massage comes with a weekday booking."),
    ).toBeNull();
  });
});

describe("a subheadline that says its headline in other words", () => {
  it("is a restatement when only the wording of one concept differs", () => {
    expect(
      restatesHeadline(
        beatOf({
          headline: "Farmers pay nothing upfront",
          subheadline: "No upfront cost for farmers.",
        }),
      ),
    ).toBe(true);
    expect(
      restatesHeadline(
        beatOf({
          headline: "Farmers pay nothing upfront",
          subheadline:
            "They rent crates by the day, only when a harvest needs them.",
        }),
      ),
    ).toBe(false);
  });
});
