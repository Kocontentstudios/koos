import { describe, expect, it } from "vitest";
import { settleBriefFacts } from "./brief-facts";
import { factLedger, looksCutOff, reasonHolds } from "./claims";
import {
  clampAtClause,
  copyFault,
  copyReasons,
  correctionCheck,
  correctionHolds,
  type DirectionChecks,
  documentReasons,
  drawnCopyOf,
  factualReasons,
  finalizeDirection,
  foreignWords,
  groundingAnchors,
  isAction,
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
        "The headline names the strawberry mille-feuille straight away.",
        "It gives the ₦4,500 price, so nobody has to ask.",
        "The image shows the strawberry mille-feuille itself.",
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

/* u3-r2-code/reasons-probe.log: an event brief with no product, a CTA too
   long to keep, and two reasons the checks refuse. Round 2 delivered none. */
describe("the two-reason floor", () => {
  const meetupBrief =
    "Promote our Lekki founders meetup. Talks from local founders, networking, light refreshments. RSVP on our website.";
  const meetupChecks: DirectionChecks = {
    ledger: factLedger([
      meetupBrief,
      "Founders meetup",
      "Lekki Founders Circle",
    ]),
    briefText: meetupBrief,
    title: "Founders meetup",
    audience: "early-stage founders",
  };
  const meetup: DirectionDraft = {
    ...draft,
    headline: "Build alongside Lekki founders",
    subheadline: "Talks, networking and light refreshments",
    cta: "Reserve your seat on our website before it fills",
    productName: "",
    productLook: "",
    backgroundPrompt:
      "a single speaker on a small stage, warm evening light, audience in silhouette",
    rationale: [
      "Bold headline at the top grabs attention",
      "Warm evening light makes it feel welcoming",
    ],
  };

  for (const [label, paintedScene] of [
    ["KO", meetup.backgroundPrompt],
    ["upload", undefined],
  ] as const) {
    it(`keeps two true reasons on the ${label} path`, () => {
      const { direction } = finalizeDirection(meetup, {
        aspectRatio: "4:5",
        checks: meetupChecks,
        fallbackTitle: "show the moment",
        paintedScene,
      });
      expect(direction.rationale.length).toBeGreaterThanOrEqual(2);
      expect(directionSpecSchema.safeParse(direction).success).toBe(true);
    });
  }

  it("never drops below two, whatever the model wrote", () => {
    const headlines = [
      "Hi",
      "Strawberry mille-feuille is here",
      "A very long headline that goes on and on to the edge of seventy ch",
    ];
    for (const headline of headlines) {
      for (const subheadline of [undefined, "₦4,500 a slice from Monday"]) {
        for (const cta of [undefined, "Order now"]) {
          for (const rationale of [
            ["Bold type at the top"],
            ["Soft light", "Deep burgundy tones"],
            [],
          ]) {
            const settled = settleReasons(rationale, {
              copy: { headline, subheadline, cta, footerLines: [] },
              checks,
              product: "",
              image: "none",
            });
            expect(settled.reasons.length).toBeGreaterThanOrEqual(2);
            for (const reason of settled.reasons) {
              expect(reason.length).toBeLessThanOrEqual(COPY_LIMITS.reason);
            }
          }
        }
      }
    }
  });

  it("quotes only copy that is drawn", () => {
    expect(copyReasons({ headline: "Hi there", footerLines: [] })).toEqual([
      'The headline reads "Hi there".',
      "Every word on it comes from the brief or the brand profile.",
    ]);
    expect(
      copyReasons({
        headline: "Strawberry mille-feuille is here",
        cta: "Order now",
        footerLines: [],
      }),
    ).toEqual([
      'The headline reads "Strawberry mille-feuille is here".',
      'The button says "Order now".',
    ]);
  });

  /* Round-3 code critic, break 9: a headline too long to quote left one
     reason, and that one was an unmeasured hierarchy claim. */
  it("keeps two reasons for any copy, claiming nothing about size", () => {
    const reasons = copyReasons({
      headline: "A".repeat(70),
      footerLines: [],
    });
    expect(reasons).toHaveLength(2);
    expect(reasons.join(" ")).not.toMatch(/competes|larger|first/);
    for (const reason of reasons) expect(reason).toMatch(/\.$/);
  });
});

describe("documentReasons", () => {
  const text = (id: string, role: string, fontSize: number, y: number) => ({
    id,
    type: "text" as const,
    role,
    fontSize,
    x: 80,
    y,
    width: 900,
    height: fontSize * 1.2,
  });

  it("says only what the document measures", () => {
    const doc = {
      width: 1080,
      height: 1350,
      elements: [
        text("headline", "headline", 96, 200),
        text("subheadline", "subheadline", 40, 400),
        { id: "logo", type: "logo", x: 900, y: 40, width: 120, height: 60 },
      ],
    };
    expect(
      documentReasons({ document: doc as never, subject: { ok: true } }),
    ).toEqual([
      "The headline is set larger than every other line.",
      "The product is drawn whole, with no copy laid over it.",
      "The brand's logo is in the top right corner.",
    ]);
  });

  it("claims nothing the document contradicts", () => {
    const doc = {
      width: 1080,
      height: 1350,
      elements: [
        text("headline", "headline", 40, 200),
        text("subheadline", "subheadline", 48, 400),
        { id: "logo", type: "logo", x: 480, y: 40, width: 120, height: 60 },
      ],
    };
    expect(
      documentReasons({ document: doc as never, subject: { ok: false } }),
    ).toEqual([]);
  });
});

describe("copyFault on the model's own copy", () => {
  /* u3-r2-code/finalize-probe.log case B: drawn as written. */
  it("sends cut-off copy back like any other fault", () => {
    for (const copy of [
      "Treat yourself to the",
      "Something sweet is coming…",
      "Layers of",
    ]) {
      expect(copyFault(copy, 70, checks.ledger)).toBe(
        "reads as an unfinished sentence",
      );
    }
    expect(
      copyFault("Strawberry mille-feuille is here", 70, checks.ledger),
    ).toBe(null);
  });

  it("falls back to the brief's title rather than draw a cut headline", () => {
    const { direction, report } = finalizeDirection(
      { ...draft, headline: "Treat yourself to the" },
      { aspectRatio: "4:5", checks, fallbackTitle: "show the product" },
    );
    expect(direction.headline).toBe("Strawberry mille-feuille launch");
    expect(report.copyFallbacks[0]).toMatchObject({ field: "headline" });
  });
});

describe("drawnCopyOf", () => {
  /* Round-3 live critic: a reason praised a footer bar the builder had
     dropped as a repeat. The copy is read off what was drawn. */
  it("reads the copy the document draws, not the spec's", () => {
    const copy = drawnCopyOf([
      {
        id: "quote-mark",
        type: "text",
        role: "body",
        text: "“",
        hidden: false,
      },
      {
        id: "headline",
        type: "text",
        role: "headline",
        text: "Pour your best",
        hidden: false,
      },
      { id: "cta", type: "button", label: "Book a seat", hidden: false },
      {
        id: "footer-1",
        type: "text",
        role: "footer",
        text: "10 seats",
        hidden: false,
      },
      {
        id: "footer-2",
        type: "text",
        role: "footer",
        text: "Hidden",
        hidden: true,
      },
    ] as never);
    expect(copy).toEqual({
      headline: "Pour your best",
      cta: "Book a seat",
      footerLines: ["10 seats"],
    });
  });
});

describe("correctionHolds", () => {
  const ledger = factLedger([
    "Promote our almond croissants, ₦4,500 a box. Pickup Saturday from 7am.",
  ]);
  const { facts } = settleBriefFacts(
    [
      { kind: "price", text: "₦4,500" },
      { kind: "day", text: "Saturday" },
      { kind: "time", text: "from 7am" },
    ],
    "Promote our almond croissants, ₦4,500 a box. Pickup Saturday from 7am.",
    {},
  );
  const holds = correctionHolds(ledger, facts);
  const before = {
    headline: "Almond croissants",
    footerLines: ["₦4,500 · Saturday · From 7am"],
  };

  it("refuses a correction that drops a fact the direction stated", () => {
    expect(holds(before, { ...before, footerLines: [] })).toBe(false);
  });

  it("refuses copy that invents, and accepts a rewrite that keeps the facts", () => {
    expect(
      holds(before, { ...before, headline: "Still warm almond croissants" }),
    ).toBe(false);
    expect(
      holds(before, { ...before, headline: "Almond croissants by the box" }),
    ).toBe(true);
  });
});

/* Round-5 live run, fashion: one reason shown twice in other words, and a
   price template reading "the ₦64,000, price". */
describe("settleReasons, round 5", () => {
  const checks = {
    ledger: factLedger(["The indigo adire kaftan, ₦64,000, only 20 made."]),
    briefText: "The indigo adire kaftan, ₦64,000, only 20 made.",
    title: "Kaftan",
  };
  const copy = {
    headline: "The Indigo Adire Kaftan",
    subheadline: "Hand-dyed. ₦64,000, only 20 made.",
    footerLines: [],
  };

  it("never shows one reason twice in other words", () => {
    const { reasons } = settleReasons(
      [
        "The headline names the indigo adire kaftan directly and plainly.",
        "The headline names the indigo adire kaftan straight away.",
      ],
      { copy, checks, product: "indigo adire kaftan", image: "none" },
    );
    expect(reasons).toHaveLength(2);
    expect(reasons[1]).not.toMatch(/names the indigo adire kaftan/);
  });

  it("writes a price without the comma after it", () => {
    const { reasons } = settleReasons([], {
      copy,
      checks,
      product: "",
      image: "none",
    });
    expect(reasons.join(" ")).not.toMatch(/,\s+price/);
  });
});

/* Round-5 code critic K14: a gate correction to "Livraison gratuite à
   Lekki" was kept and delivered: French, an invented free delivery, and
   the product no longer named. */
describe("correctionHolds and correctionCheck, round 6", () => {
  const brief =
    "Launch our almond croissants, ₦4,500 a box. Pickup at weekends from our Lekki bakery.";
  const ledger = factLedger([brief]);
  const before = {
    headline: "Almond croissants for the commute",
    subheadline: "₦4,500 a box, weekends",
    footerLines: [],
  };
  const brand = { name: "Crumb" } as never;

  it("refuses copy in another language", () => {
    const holds = correctionHolds(ledger, [], {
      offering: "almond croissants",
    });
    expect(
      holds(before, { ...before, headline: "Livraison gratuite à Lekki" }),
    ).toBe(false);
    expect(foreignWords("Livraison gratuite à Lekki", brief)).toEqual([
      "Livraison",
      "gratuite",
      "à",
    ]);
    expect(foreignWords("Pickup at our Lekki café", "Our Lekki café")).toEqual(
      [],
    );
  });

  it("refuses a rewrite that stops naming what the brief promotes", () => {
    const holds = correctionHolds(ledger, [], {
      offering: "almond croissants",
    });
    expect(holds(before, { ...before, headline: "Your weekend treat" })).toBe(
      false,
    );
    expect(
      holds(before, { ...before, headline: "Almond croissants by the box" }),
    ).toBe(true);
  });

  it("puts the fields a correction changed to the claim check", async () => {
    const asked: string[][] = [];
    const check = correctionCheck({
      ledger,
      facts: [],
      offering: "almond croissants",
      checker: async ({ fields }) => {
        asked.push(fields.map((f) => f.id));
        return fields.some((f) => /Ada/.test(f.text))
          ? [{ id: fields[0].id, statement: "baked by Ada", rewrite: "" }]
          : [];
      },
      briefText: brief,
      title: "",
      brand,
    });
    expect(
      await check(before, {
        ...before,
        headline: "Almond croissants, baked by Ada",
      }),
    ).toBe(false);
    expect(
      await check(before, { ...before, headline: "Almond croissants, boxed" }),
    ).toBe(true);
    expect(asked).toEqual([["0.headline"], ["0.headline"]]);
    expect(await check(before, before)).toBe(true);
    expect(asked).toHaveLength(2);
  });

  /* Round 7: fail-closed (round-6 code critic, r6-merge: a "Hand-woven"
     merge shipped while the check was down). */
  it("refuses every change when the claim check is down", async () => {
    const check = correctionCheck({
      ledger,
      facts: [],
      offering: "almond croissants",
      checker: async () => null,
      briefText: brief,
      title: "",
      brand,
    });
    expect(
      await check(before, { ...before, headline: "Almond croissants, boxed" }),
    ).toBe(false);
    expect(await check(before, before)).toBe(true);
    expect(
      await check(before, {
        ...before,
        headline: "Livraison gratuite à Lekki",
      }),
    ).toBe(false);
  });
});

/* Round-6 eval, fintech-ko: two quote top-ups were delivered that the
   reason check reads as claiming a price is shown. */
describe("settleReasons top-ups hold too", () => {
  it("never tops up with a quote the reason check refuses", () => {
    const checks = {
      ledger: factLedger([
        "Send money to 20 African countries with zero transfer fees for your first month.",
      ]),
      briefText:
        "Send money to 20 African countries with zero transfer fees for your first month.",
      title: "",
    };
    const copy = {
      headline: "Send money. Zero fees.",
      cta: "Download the app",
      footerLines: [],
    };
    const { reasons } = settleReasons([], {
      copy,
      checks,
      product: "",
      image: "none",
    });
    expect(reasons).toHaveLength(2);
    for (const reason of reasons) {
      expect(
        reasonHolds(reason, {
          copy,
          ledger: checks.ledger,
          briefText: checks.briefText,
          product: "",
          image: "pending",
        }).ok,
      ).toBe(true);
    }
  });
});

/* Round-7 code critic, C1 and C2, and isAction's false positives. */
describe("round-8 correction and button rules", () => {
  const ledger = factLedger([
    "JSS tutoring in Yaba on Saturdays. First session free. Book on 0803 555 0142.",
  ]);
  const holds = correctionHolds(ledger, []);
  const before = {
    headline: "Maths that clicks",
    subheadline: "JSS tutoring in Yaba on Saturdays.",
    cta: "Book a session",
    footerLines: [],
  };

  it("C1: refuses a correction that makes the button a label", () => {
    expect(holds(before, { ...before, cta: "First session free" })).toBe(false);
  });

  it("C2: refuses a correction that makes the subheadline a list", () => {
    expect(
      holds(before, {
        ...before,
        subheadline: "JSS tutoring. Yaba. Saturdays. First session free.",
      }),
    ).toBe(false);
  });

  it.each([
    "Open 7 days a week",
    "Shop 12, Admiralty Mall",
    "Book club Saturdays",
  ])("%s is not an action", (label) => {
    expect(isAction(label)).toBe(false);
  });

  it.each(["Book a session", "Shop now", "Open the app", "Order by 8pm"])(
    "%s is an action",
    (label) => {
      expect(isAction(label)).toBe(true);
    },
  );
});
