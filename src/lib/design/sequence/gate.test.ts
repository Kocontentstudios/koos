import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { setFaults } from "./faults";
import { CAFE_BRIEF, CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { asSentence, type GateRules, shipGate, unsourcedOnSet } from "./gate";
import { validateSequence } from "./validate";

const PROFILE =
  "Beans from one farm on the Plateau; roasted in-house each week";

const rules = (over: Partial<GateRules> = {}): GateRules => ({
  frameCount: 5,
  facts: CAFE_FACTS,
  offering: "cold brew",
  hasImage: true,
  brandName: "Kiln Coffee",
  names: ["cold brew"],
  ledger: factLedger([CAFE_BRIEF, "Kiln Coffee", PROFILE], 2),
  claims: [
    "Slow-steeped cold brew for a slower Saturday",
    "Beans from one farm on the Plateau",
    "Roasted in-house each week",
    "Pour one at our Yaba bar",
    "",
  ],
  unsourced: [],
  ...over,
});

describe("asSentence", () => {
  it("starts with a capital and ends on a stop", () => {
    expect(asSentence("beans from one farm")).toBe("Beans from one farm.");
    expect(asSentence("Ready?")).toBe("Ready?");
  });
});

describe("shipGate: no unsourced statement ships", () => {
  it("cuts the sentence the audit read as unsourced", () => {
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "Sit in with a glass. Walk-ins get a free refill.",
    });
    const flagged = rules({
      unsourced: [
        { kind: "unsourced", frame: 3, text: "Walk-ins get a free refill" },
      ],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[3].subheadline).toBe("Sit in with a glass.");
    expect(unsourcedOnSet(gated.frames, flagged)).toEqual([]);
  });

  it("puts the frame's claim in place of a lone unsourced subheadline, or leaves it out", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "A single origin you can taste",
      subheadline: "No levies and no deposits for any order.",
    });
    const flagged = rules({
      unsourced: [
        { kind: "unsourced", frame: 1, text: "No levies and no deposits" },
      ],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[1].subheadline).toBe(
      "Beans from one farm on the Plateau.",
    );
    expect(unsourcedOnSet(gated.frames, flagged)).toEqual([]);
    const { plan: bare } = shipGate(plan, { ...flagged, claims: [] });
    expect(bare.frames[1].subheadline).toBe("");
  });

  it("cuts a number no source gives", () => {
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "Sit in with a glass. Over 400 regulars a week.",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[3].subheadline).not.toMatch(/400/);
    expect(unsourcedOnSet(gated.frames, rules())).toEqual([]);
  });
});

describe("shipGate: headlines", () => {
  it("takes a carousel's price out of a headline before the action", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Slow-steeped cold brew, ₦2,500 a bottle",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[0].headline).toBe("Slow-steeped cold brew");
  });

  it("sets a body headline making another frame's point to its own claim", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        headline: "Roasted at our Yaba bar weekly",
        subheadline: "Every batch is roasted at the bar.",
      }),
      2,
      {
        headline: "Roasted at our Yaba bar every week",
        subheadline: "Our roaster runs each Monday.",
      },
    );
    const { plan: gated } = shipGate(plan, rules());
    const repeats = validateSequence(gated, rules()).filter(
      (p) => p.rule === "headline-repeat",
    );
    expect(repeats).toEqual([]);
    expect(gated.frames[2].headline).toBe("Roasted in-house each week");
  });
});

describe("shipGate: subheadlines", () => {
  it("replaces a subheadline split off its subject", () => {
    const plan = withFrame(cafePlan(), 2, {
      subheadline: "is roasted the week it is poured.",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[2].subheadline).toBe("Roasted in-house each week.");
  });

  it("gives a middle frame with a headline alone its claim as a sentence", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "One farm on the Plateau",
      subheadline: "",
    });
    const { plan: gated } = shipGate(
      plan,
      rules({
        claims: ["", "Every bean is grown by one family farm", "", "", ""],
        ledger: factLedger(
          [CAFE_BRIEF, "Kiln Coffee", "Every bean is grown by one family farm"],
          2,
        ),
      }),
    );
    expect(gated.frames[1].subheadline).toBe(
      "Every bean is grown by one family farm.",
    );
  });

  it("never writes a claim that restates the frame's headline under it", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "Beans from one Plateau farm",
      subheadline: "",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[1].subheadline).toBe("");
  });
});

describe("shipGate: the hook", () => {
  it("names the offering on a hook that left it out", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Your Saturday, slowed down",
      subheadline: "Steeped slow and poured over ice.",
    });
    const before = validateSequence(plan, rules()).map((p) => p.rule);
    expect(before).toContain("offering-unnamed");
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[0].subheadline).toBe(
      "Cold brew at Kiln Coffee. Steeped slow and poured over ice.",
    );
    expect(validateSequence(gated, rules()).map((p) => p.rule)).not.toContain(
      "offering-unnamed",
    );
  });

  it("cuts the hook's sentence that spends a later frame's point", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline:
        "Our cold brew, slow-steeped. Pour one at our Yaba bar and sit in.",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[0].subheadline).toBe("Our cold brew, slow-steeped.");
  });

  it("leaves a clean set as it is", () => {
    const plan = cafePlan();
    const clean = setFaults(plan, rules()).length;
    const { plan: gated, applied } = shipGate(plan, rules());
    expect(setFaults(gated, rules()).length).toBeLessThanOrEqual(clean);
    expect(gated.frames[4]).toEqual(plan.frames[4]);
    expect(applied.every((a) => !a.startsWith("frame 5"))).toBe(true);
  });
});

describe("shipGate: what it never takes", () => {
  it("never drops a sentence over one unsourced word", () => {
    const plan = withFrame(cafePlan(), 0, {
      subheadline: "Our cold brew, poured with care.",
    });
    const flagged = rules({
      unsourced: [{ kind: "unsourced", frame: 0, text: "care" }],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[0].subheadline).toBe(
      "Our cold brew, poured with care.",
    );
  });

  it("never cuts the sentence that names the offering on the hook", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Your Saturday, slowed down",
      subheadline: "Our cold brew comes from a secret family recipe.",
    });
    const flagged = rules({
      unsourced: [
        { kind: "unsourced", frame: 0, text: "a secret family recipe" },
      ],
      claims: [],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[0].subheadline).toMatch(/cold brew/i);
  });

  it("names the brand too when the brief makes it the subject", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Your Saturday, slowed down",
      subheadline: "",
    });
    const { plan: gated } = shipGate(
      plan,
      rules({ names: ["cold brew", "Kiln Coffee"] }),
    );
    expect(gated.frames[0].subheadline).toBe("Cold brew from Kiln Coffee.");
  });

  it("takes a deck's ask out of a headline before the action slide", () => {
    const deck = withFrame(cafePlan({ kind: "presentation" }), 0, {
      headline: "Slow-steeped cold brew, ₦2,500 a bottle",
    });
    const asked = shipGate(deck, rules({ atAction: new Set([1]) }));
    expect(asked.plan.frames[0].headline).toBe("Slow-steeped cold brew");
    const result = shipGate(deck, rules());
    expect(result.plan.frames[0].headline).toBe(
      "Slow-steeped cold brew, ₦2,500 a bottle",
    );
  });
});

describe("shipGate: one unsourced word", () => {
  it("puts the frame's claim in place of a sentence holding an invented count", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "A roast you can taste",
      subheadline: "Our roaster runs two batches.",
    });
    const flagged = rules({
      unsourced: [{ kind: "unsourced", frame: 2, text: "two" }],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[2].subheadline).toBe("Roasted in-house each week.");
  });
});

describe("shipGate: an unsourced sentence on the hook", () => {
  it("puts the hook's names in place of a lone sentence no source gives", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Your Saturday, slowed down",
      subheadline: "Our cold brew is smooth, never bitter.",
    });
    const flagged = rules({
      unsourced: [
        { kind: "unsourced", frame: 0, text: "smooth, never bitter" },
      ],
      claims: [],
    });
    const { plan: gated } = shipGate(plan, flagged);
    expect(gated.frames[0].subheadline).toBe("Cold brew at Kiln Coffee.");
    expect(unsourcedOnSet(gated.frames, flagged)).toEqual([]);
  });
});

describe("shipGate: a hook whose second line says the first again", () => {
  it("cuts the echoing sentence and keeps the one that adds something", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Cold brew steeped slow",
      subheadline: "Our cold brew is steeped slow. Served over ice.",
    });
    const { plan: gated, applied } = shipGate(plan, rules());
    expect(gated.frames[0].subheadline).toBe("Served over ice.");
    expect(applied).toContain(
      "frame 1: hook subheadline echoing its headline cut",
    );
  });

  it("leaves the second line empty when every sentence echoes and the headline names the offering", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Cold brew steeped slow",
      subheadline: "Our cold brew, steeped slow.",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[0].subheadline).toBe("");
    expect(gated.frames[0].headline).toBe("Cold brew steeped slow");
  });
});

describe("shipGate: no headline makes another frame's point", () => {
  it("gives a middle frame a spare point when its own claim cannot stand apart", () => {
    const plan = withFrame(cafePlan(), 3, {
      headline: "Your Saturday, slowed down again",
      subheadline: "Sit in with a glass, or carry yours out.",
    });
    const twin = rules({
      claims: ["", "", "", "Your Saturday slowed down", ""],
      spares: ["Roasted in-house each week"],
    });
    const before = validateSequence(plan, twin).filter(
      (p) => p.rule === "headline-repeat",
    );
    expect(before).not.toEqual([]);
    const { plan: gated, applied } = shipGate(plan, twin);
    expect(gated.frames[3].headline).toBe("Roasted in-house each week");
    expect(applied).toContain("frame 4: repeated headline given a spare point");
    expect(
      validateSequence(gated, twin).filter((p) => p.rule === "headline-repeat"),
    ).toEqual([]);
  });
});

describe("shipGate: a headline that leans on the frame before", () => {
  it("sets a fragment headline to the frame's claim", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "for early risers",
      subheadline: "8am to 2pm",
    });
    const { plan: gated } = shipGate(
      plan,
      rules({ claims: ["", "", "Roasted in-house each week", "", ""] }),
    );
    expect(gated.frames[2].headline).toBe("Roasted in-house each week");
  });

  it("starts it with a capital when no claim can stand in", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "slow mornings at the bar start early",
      subheadline: "8am to 2pm",
    });
    const { plan: gated } = shipGate(plan, rules({ claims: [] }));
    expect(gated.frames[2].headline).toBe(
      "Slow mornings at the bar start early",
    );
  });
});

describe("shipGate: the hook names what the brief offers", () => {
  it("writes a product fact the hook leaves out onto it, whatever phrase was read as the offering", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Steeped slow, poured over ice",
      subheadline: "",
    });
    const product = { ...CAFE_FACTS[0] };
    expect(product.kind).toBe("product");
    const { plan: gated } = shipGate(
      plan,
      rules({ offering: null, names: [], claims: [] }),
    );
    expect(gated.frames[0].subheadline.toLowerCase()).toContain(
      product.text.toLowerCase(),
    );
  });
});

describe("shipGate: a carousel's price waits for the action", () => {
  it("cuts the hook's sentence that gives the price", () => {
    const plan = withFrame(cafePlan(), 0, {
      headline: "Your Saturday, slowed down",
      subheadline: "Our cold brew, served over ice. Yours for ₦2,500 a bottle.",
    });
    const { plan: gated } = shipGate(plan, rules());
    expect(gated.frames[0].subheadline).toBe("Our cold brew, served over ice.");
  });
});
