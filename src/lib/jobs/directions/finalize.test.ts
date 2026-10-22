import { describe, expect, it } from "vitest";
import { factLedger, looksCutOff } from "./claims";
import {
  clampAtClause,
  type DirectionChecks,
  factualReasons,
  finalizeDirection,
  groundingAnchors,
  isGrounded,
  settleReasons,
} from "./finalize";
import {
  COPY_LIMITS,
  type DirectionDraft,
  directionSpecSchema,
} from "./schema";

const BRIEF =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";

const checks: DirectionChecks = {
  ledger: factLedger([BRIEF, "Neighbourhood French bakery in Lekki"]),
  briefText: BRIEF,
  title: "Strawberry mille-feuille launch",
};

const draft: DirectionDraft = {
  layout: "hero-center",
  headline: "Strawberry mille-feuille is here",
  subheadline: "₦4,500 a slice from Monday",
  cta: "Order for 7am pickup",
  footerStyle: "none",
  footerLines: [],
  palette: { background: "#FFF4E6", foreground: "#3B2416", accent: "#C2410C" },
  logoPlacement: "top-right",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "a slice of mille-feuille on a marble counter",
  backgroundTreatment: "photographic",
  nativePrompt: "a bakery poster",
  aspectRatio: "1:1",
  title: "Morning bake story",
  rationale: [
    "The headline names the strawberry mille-feuille",
    "The subheadline gives the ₦4,500 price and Monday",
  ],
  productName: "strawberry mille-feuille",
  productLook:
    "a rectangular slice of three crisp puff pastry layers with piped cream and halved strawberries",
};

const options = {
  aspectRatio: "4:5" as const,
  checks,
  fallbackTitle: "the product",
};

const run = (over: Partial<DirectionDraft> = {}) =>
  finalizeDirection({ ...draft, ...over }, options);

describe("clampAtClause", () => {
  it("leaves text within the limit alone, whitespace collapsed", () => {
    expect(clampAtClause("  Names  the price ", 90)).toBe("Names the price");
  });

  it("keeps whole clauses that fit", () => {
    expect(
      clampAtClause(
        "The headline names the mille-feuille, so commuters know at once what is new this week",
        60,
      ),
    ).toBe("The headline names the mille-feuille");
  });

  /* Round-1 code critic: a word-boundary cut reads as a sentence that broke
     off. A clause that does not fit is now never cut inside. */
  it("returns null rather than cut inside a clause", () => {
    expect(
      clampAtClause(
        "Pre-order your handwoven throw today before stock runs out",
        32,
      ),
    ).toBeNull();
  });

  it("refuses a fragment too short to say anything", () => {
    expect(
      clampAtClause("Yes, the strawberry mille-feuille arrives Monday", 30),
    ).toBeNull();
  });

  it("never returns text that reads as cut off", () => {
    const out = clampAtClause(
      "Price and the, pickup time and the day all in one line of copy",
      40,
    );
    if (out) expect(looksCutOff(out)).toBe(false);
  });
});

describe("grounding", () => {
  const anchors = groundingAnchors({
    briefText: BRIEF,
    title: checks.title,
    product: "strawberry mille-feuille",
    ledger: checks.ledger,
  });

  it("counts a reason that names a hard fact", () => {
    expect(isGrounded("Names the strawberry mille-feuille", anchors)).toBe(
      true,
    );
    expect(isGrounded("Gives ₦4,500 up top", anchors)).toBe(true);
    expect(isGrounded("Puts the price first", anchors)).toBe(true);
    expect(isGrounded("Commuters see Monday", anchors)).toBe(true);
  });

  /* Round-1 critic: one shared word counted "Warm tones feel inviting and
     friendly" as grounded because the brand's tone said "warm". */
  it("does not count one generic shared word", () => {
    expect(isGrounded("Warm tones feel inviting and friendly", anchors)).toBe(
      false,
    );
    expect(isGrounded("A new design for the launch", anchors)).toBe(false);
  });

  it("counts two of the brief's own words", () => {
    expect(isGrounded("Speaks to commuters who order ahead", anchors)).toBe(
      true,
    );
  });
});

describe("finalizeDirection", () => {
  it("draws every direction on the canvas the user asked for", () => {
    expect(run().direction.aspectRatio).toBe("4:5");
  });

  it("delivers a direction inside the contract", () => {
    expect(directionSpecSchema.safeParse(run().direction).success).toBe(true);
  });

  it("keeps whole clauses of an over-long headline, never a cut one", () => {
    const { direction, report } = run({
      headline:
        "Strawberry mille-feuille is here — layered by hand every morning before the first commuter",
    });
    expect(direction.headline).toBe("Strawberry mille-feuille is here");
    expect(report.copyFallbacks).toHaveLength(1);
  });

  it("falls back to the brief's title when the headline cannot be kept", () => {
    const { direction } = run({
      headline: "Seven layers, seven minutes from your door",
    });
    expect(direction.headline).toBe("Strawberry mille-feuille launch");
  });

  /* Round-1 code critic, variant a: "Pre-order your handwoven throw…" on the
     button. A button that cannot be kept whole is left off. */
  it("leaves off a button it cannot keep whole, with no ellipsis", () => {
    const { direction } = run({
      cta: "Pre-order your strawberry mille-feuille today before they go",
    });
    expect(direction.cta).toBeUndefined();
    expect(JSON.stringify(direction)).not.toContain("…");
  });

  it("drops copy that states a fact the brief does not", () => {
    const { direction } = run({
      subheadline: "Free delivery across Lekki",
      footerLines: ["Open 6am to 9pm", "Order ahead"],
      footerStyle: "text",
    });
    expect(direction.subheadline).toBeUndefined();
    expect(direction.footerLines).toEqual(["Order ahead"]);
  });

  it("turns the footer off when no line survives", () => {
    const { direction } = run({
      footerLines: ["Open 6am to 9pm"],
      footerStyle: "bar",
    });
    expect(direction.footerLines).toEqual([]);
    expect(direction.footerStyle).toBe("none");
  });

  it("keeps the product only when the brief names it", () => {
    expect(run().direction.productName).toBe("strawberry mille-feuille");
    const tart = run({ productName: "strawberry tart", productLook: "a tart" });
    expect(tart.direction.productName).toBe("");
    expect(tart.direction.productLook).toBe("");
  });

  it("keeps a whole title or uses the concept's lead", () => {
    expect(run().direction.title).toBe("Morning bake story");
    expect(
      run({ title: "A very long concept name that goes on and on forever" })
        .direction.title,
    ).toBe("The product");
  });
});

describe("settleReasons", () => {
  const settings = {
    copy: {
      headline: "Strawberry mille-feuille is here",
      subheadline: "₦4,500 a slice from Monday",
      cta: "Order for 7am pickup",
      footerLines: [],
    },
    checks,
    product: "strawberry mille-feuille",
    image: "pending" as const,
  };

  /* The four false reasons the round-1 live critic named. */
  it("drops spatial claims, invented facts and false element claims", () => {
    const { reasons, dropped } = settleReasons(
      [
        "Product fills two-thirds of the frame",
        "Pastry glows against the dark ground",
        "Seven minutes from your door, every morning",
        "The headline gives the price and the day",
        "The headline names the strawberry mille-feuille",
      ],
      settings,
    );
    expect(reasons[0]).toBe("The headline names the strawberry mille-feuille");
    expect(dropped.map((d) => d.reason)).toEqual([
      "Product fills two-thirds of the frame",
      "Pastry glows against the dark ground",
      "Seven minutes from your door, every morning",
      "The headline gives the price and the day",
    ]);
  });

  it("tops up from facts the copy carries, never below two", () => {
    const { reasons } = settleReasons(["Looks great"], settings);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    for (const reason of reasons) {
      expect(reason.length).toBeLessThanOrEqual(COPY_LIMITS.reason);
    }
  });

  it("never shows a reason cut mid-clause", () => {
    const { reasons } = settleReasons(
      [
        "The headline names the strawberry mille-feuille that commuters have been asking the bakery about for weeks now",
        "The subheadline gives the ₦4,500 price and Monday",
      ],
      settings,
    );
    for (const reason of reasons) expect(looksCutOff(reason)).toBe(false);
    expect(reasons).not.toContain(
      "The headline names the strawberry mille-feuille that commuters have been asking the",
    );
  });

  it("drops a reason about the image when the design has none", () => {
    const { reasons } = settleReasons(
      ["The photo shows the strawberry mille-feuille itself", "Looks great"],
      { ...settings, image: "none" },
    );
    expect(reasons).not.toContain(
      "The photo shows the strawberry mille-feuille itself",
    );
  });

  it("caps the list at four and removes duplicates", () => {
    const { reasons } = settleReasons(
      [
        "The headline names the strawberry mille-feuille",
        "The headline names the strawberry mille-feuille",
        "The subheadline gives the ₦4,500 price",
        "The subheadline says Monday",
        "The button asks commuters to order for 7am pickup",
        "Speaks to commuters who order ahead",
      ],
      settings,
    );
    expect(reasons).toHaveLength(4);
    expect(new Set(reasons).size).toBe(4);
  });
});

describe("factualReasons", () => {
  it("are true of the copy they were read from", () => {
    const reasons = factualReasons({
      copy: {
        headline: "Strawberry mille-feuille is here",
        subheadline: "₦4,500 a slice from Monday",
        cta: "Order for 7am pickup",
        footerLines: [],
      },
      checks,
      product: "strawberry mille-feuille",
      image: "verified",
    });
    expect(reasons).toEqual(
      expect.arrayContaining([
        "The headline names the strawberry mille-feuille straight away",
        "It gives the ₦4,500 price, so nobody has to ask",
        "The image shows the strawberry mille-feuille itself",
      ]),
    );
  });

  it("says nothing about a price the copy does not carry", () => {
    const reasons = factualReasons({
      copy: { headline: "Layer on layer", footerLines: [] },
      checks,
      product: "strawberry mille-feuille",
      image: "none",
    });
    expect(reasons.join(" ")).not.toMatch(/price|image/);
  });
});
