// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const {
  askFooterRewrites,
  buildFooterRepeatPrompt,
  buildFooterRewritePrompt,
  checkFooterRepeats,
  dropButtonEchoes,
  dropMarkedRepeats,
  marksNeedingRewrite,
  readsAsList,
  settleMarkedRepeats,
} = await import("./footer-repeats");
const { settleBriefFacts } = await import("./brief-facts");

const retreat = {
  headline: "Step away this December",
  subheadline: "A retreat outside Ibadan, 12–14 December. Free registration.",
  cta: "Register Free",
  footerLines: [
    "Friday 12 December · Sunday 14 December",
    "Free registration · stillwater.ng",
  ],
  footerStyle: "text" as const,
};

beforeEach(() => generateObject.mockReset());

describe("checkFooterRepeats", () => {
  it("asks about each footer item by id, beside the copy above it", async () => {
    generateObject.mockResolvedValue({
      object: { repeats: [{ id: "0.2", repeats: "the button" }] },
    });
    expect(await checkFooterRepeats([retreat])).toEqual([
      { id: "0.2", repeats: "the button" },
    ]);
    const prompt = buildFooterRepeatPrompt([retreat]);
    expect(prompt).toContain("footer item 0.0: Friday 12 December");
    expect(prompt).toContain("footer item 0.3: stillwater.ng");
    expect(prompt).toContain("button: Register Free");
  });

  it("ignores ids it did not ask about, and is fail-soft", async () => {
    generateObject.mockResolvedValue({
      object: { repeats: [{ id: "4.9", repeats: "x" }] },
    });
    expect(await checkFooterRepeats([retreat])).toEqual([]);
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    expect(await checkFooterRepeats([retreat])).toBeNull();
  });

  it("makes no call for directions without a footer", async () => {
    expect(await checkFooterRepeats([{ ...retreat, footerLines: [] }])).toEqual(
      [],
    );
    expect(generateObject).not.toHaveBeenCalled();
  });
});

describe("dropMarkedRepeats", () => {
  const brief =
    "Weekend retreat outside Ibadan, Friday 12 December to Sunday 14 December. Free registration at stillwater.ng.";
  const facts = settleBriefFacts(
    [
      { kind: "date", text: "Friday 12 December to Sunday 14 December" },
      { kind: "price", text: "Free registration" },
      { kind: "contact", text: "stillwater.ng" },
    ],
    brief,
    { region: "NG" },
  ).facts;

  it("drops a marked item whose facts are said elsewhere, and keeps one that carries a fact", () => {
    const { directions, outcomes } = dropMarkedRepeats(
      [retreat],
      [
        { id: "0.2", repeats: "Register Free on the button" },
        { id: "0.0", repeats: "12–14 December above" },
      ],
      facts,
    );
    expect(directions[0].footerLines).toEqual([
      "Friday 12 December · Sunday 14 December",
      "stillwater.ng",
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({ item: "Free registration", dropped: true }),
      expect.objectContaining({
        item: "Friday 12 December",
        dropped: false,
        kept: expect.stringMatching(/said nowhere else/),
      }),
    ]);
  });
});

/* Oluwaseyi's ruling: a footer item that only adds detail to the copy
   above is merged up into that field, when the merged field holds. */
describe("settleMarkedRepeats", () => {
  const brief =
    "Weekend retreat outside Ibadan, Friday 12 December to Sunday 14 December.";
  const facts = settleBriefFacts(
    [{ kind: "date", text: "Friday 12 December to Sunday 14 December" }],
    brief,
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Step away this December",
    subheadline: "A retreat outside Ibadan, 12–14 December.",
    footerLines: ["Friday 12 December to Sunday 14 December"],
    footerStyle: "text" as const,
  };
  const mark = {
    id: "0.0",
    repeats: "the dates above",
    field: "subheadline" as const,
    rewrite: "A retreat outside Ibadan, Friday 12 to Sunday 14 December.",
  };

  it("moves the detail up and drops the footer item when the rewrite holds", async () => {
    const holds = vi.fn(async () => true);
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [mark],
      facts,
      holds,
    );
    expect(directions[0].subheadline).toBe(mark.rewrite);
    expect(directions[0].footerLines).toEqual([]);
    expect(outcomes[0]).toMatchObject({
      dropped: true,
      merged: { field: "subheadline", to: mark.rewrite },
    });
    expect(holds).toHaveBeenCalledTimes(1);
  });

  it("keeps the footer item when the rewrite fails a rule or loses the fact", async () => {
    const refused = await settleMarkedRepeats(
      [direction],
      [mark],
      facts,
      async () => false,
    );
    expect(refused.directions[0]).toEqual(direction);
    expect(refused.outcomes[0].kept).toMatch(/did not hold/);
    const lossy = await settleMarkedRepeats(
      [direction],
      [{ ...mark, rewrite: "A retreat outside Ibadan." }],
      facts,
      async () => true,
    );
    expect(lossy.directions[0]).toEqual(direction);
  });

  it("keeps it when the merged field would not fit", async () => {
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [{ ...mark, rewrite: `${mark.rewrite} ${"x".repeat(140)}` }],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(direction);
    expect(outcomes[0].kept).toMatch(/would not fit/);
  });
});

/* Oluwaseyi's ruling: a merge never replaces a button's ask. The round-6
   live run had made the button "WhatsApp 0813 222 7045". */
describe("merges into a button", () => {
  const facts = settleBriefFacts(
    [{ kind: "contact", text: "WhatsApp 0813 222 7045" }],
    "Book on WhatsApp 0813 222 7045.",
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Temper chocolate",
    cta: "WhatsApp to Book",
    footerLines: ["WhatsApp 0813 222 7045"],
    footerStyle: "text" as const,
  };

  it("never rewrites the button; the detail stays below", async () => {
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [
        {
          id: "0.0",
          repeats: "the button",
          field: "button",
          rewrite: "WhatsApp 0813 222 7045",
        },
      ],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(direction);
    expect(directions[0].cta).toBe("WhatsApp to Book");
    expect(outcomes[0].kept).toBe("a button stays an action");
  });
});

describe("the second, targeted ask", () => {
  const facts = settleBriefFacts(
    [{ kind: "contact", text: "WhatsApp 0813 222 7045" }],
    "Book on WhatsApp 0813 222 7045.",
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Temper chocolate",
    subheadline: "A masterclass in Lekki.",
    cta: "WhatsApp to book",
    footerLines: ["WhatsApp 0813 222 7045 · Ages 16+"],
    footerStyle: "text" as const,
  };

  it("asks only for marked items that carry a fact and have no rewrite", () => {
    expect(
      marksNeedingRewrite(
        [direction],
        [
          { id: "0.0", repeats: "the button" },
          { id: "0.1", repeats: "nothing" },
        ],
        facts,
      ),
    ).toEqual([{ id: "0.0", item: "WhatsApp 0813 222 7045" }]);
  });

  it("asks for a subheadline rewrite and never the headline or button", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        rewrites: [
          {
            id: "0.0",
            field: "subheadline",
            rewrite: "A masterclass in Lekki. WhatsApp 0813 222 7045.",
          },
        ],
      },
    });
    const out = await askFooterRewrites(
      [direction],
      [{ id: "0.0", item: "WhatsApp 0813 222 7045" }],
    );
    expect(out).toEqual([
      {
        id: "0.0",
        field: "subheadline",
        rewrite: "A masterclass in Lekki. WhatsApp 0813 222 7045.",
      },
    ]);
    expect(
      buildFooterRewritePrompt(
        [direction],
        [{ id: "0.0", item: "WhatsApp 0813 222 7045" }],
      ),
    ).toContain("Never touch the headline or the button");
  });

  it("strips a button field from the first answer", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        repeats: [
          {
            id: "0.0",
            repeats: "the button",
            field: "button",
            rewrite: "WhatsApp 0813 222 7045",
          },
        ],
      },
    });
    expect(await checkFooterRepeats([direction])).toEqual([
      { id: "0.0", repeats: "the button" },
    ]);
  });
});

describe("a headline merge", () => {
  const facts = settleBriefFacts(
    [{ kind: "contact", text: "Call 0809 111 4462" }],
    "Call 0809 111 4462.",
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Back by 7pm",
    subheadline: "Same-day laundry.",
    cta: "Call to book",
    footerLines: ["Call 0809 111 4462"],
    footerStyle: "text" as const,
  };
  const headlineMark = {
    id: "0.0",
    repeats: "the button",
    field: "headline" as const,
    rewrite: "Back by 7pm. Call 0809 111 4462",
  };

  it("is refused while the direction has a subheadline", async () => {
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [headlineMark],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(direction);
    expect(outcomes[0].kept).toMatch(/headline is never rewritten/);
  });

  /* Round-6 eval, bakery-upload: a merge into a headline with no
     subheadline turned it into its sibling's headline plus a time. */
  it("is refused without a subheadline too", async () => {
    const { subheadline: _s, ...bare } = direction;
    const { directions, outcomes } = await settleMarkedRepeats(
      [bare],
      [headlineMark],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(bare);
    expect(outcomes[0].kept).toMatch(/headline is never rewritten/);
  });

  it("is not asked for", () => {
    const prompt = buildFooterRepeatPrompt([direction]);
    expect(prompt).toMatch(/Never rewrite the headline or the button/);
    expect(prompt).not.toMatch(/or the headline when there is no subheadline/);
  });
});

describe("a subheadline merge", () => {
  const facts = settleBriefFacts(
    [
      { kind: "date", text: "Saturday 15 November" },
      { kind: "time", text: "10am to 2pm" },
      { kind: "place", text: "Yaba Tech Hub" },
    ],
    "Hackathon at Yaba Tech Hub, Saturday 15 November, 10am to 2pm.",
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Build something by Saturday",
    subheadline: "A one-day hackathon. Saturday 15 November.",
    footerLines: ["10am to 2pm · Yaba Tech Hub"],
    footerStyle: "text" as const,
  };

  /* Round-6 eval, event slot 1: a 130-character subheadline of three
     clauses read as the footer moved up. */
  it("is refused when it reads as a list of more than two clauses", async () => {
    const holds = vi.fn(async () => true);
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [
        {
          id: "0.0",
          repeats: "the day",
          field: "subheadline",
          rewrite:
            "A one-day hackathon. Saturday 15 November. 10am to 2pm at Yaba Tech Hub.",
        },
      ],
      facts,
      holds,
    );
    expect(directions[0]).toEqual(direction);
    expect(outcomes[0].kept).toMatch(/reads as a list/);
    expect(holds).not.toHaveBeenCalled();
  });

  /* Round-8 eval at 5011429, valentine-box-upload: a footer item saying
     the headline's deadline was merged into the subheadline under it. */
  it("is refused when it makes the subheadline repeat the headline", async () => {
    const deadline = {
      headline: "Made for two. Pre-orders close 12 Feb.",
      subheadline: "A dessert box with a handwritten card.",
      footerLines: ["Pre-orders close 12 February"],
      footerStyle: "text" as const,
    };
    const holds = vi.fn(async () => true);
    const { directions, outcomes } = await settleMarkedRepeats(
      [deadline],
      [
        {
          id: "0.0",
          repeats: "the deadline in the headline",
          field: "subheadline",
          rewrite:
            "A dessert box with a handwritten card. Pre-orders close 12 February.",
        },
      ],
      settleBriefFacts(
        [{ kind: "condition", text: "Pre-orders close 12 February" }],
        "Valentine's dessert box for two. Pre-orders close 12 February.",
        { region: "NG" },
      ).facts,
      holds,
    );
    expect(directions[0]).toEqual(deadline);
    expect(outcomes[0].kept).toMatch(/would repeat the headline or button/);
    expect(holds).not.toHaveBeenCalled();
  });

  it("is refused when it leaves two directions near-duplicates", async () => {
    const { outcomes } = await settleMarkedRepeats(
      [direction],
      [
        {
          id: "0.0",
          repeats: "the day",
          field: "subheadline",
          rewrite: "A one-day hackathon, Saturday 15 November, 10am to 2pm.",
        },
      ],
      facts,
      async () => true,
      () => false,
    );
    expect(outcomes[0].dropped).toBe(false);
    expect(outcomes[0].kept).toMatch(/near-duplicates/);
  });

  it("counts clauses on sentence ends, middots, dashes and semicolons", () => {
    expect(readsAsList("A one-day hackathon. Saturday 15 November.")).toBe(
      false,
    );
    expect(readsAsList("Hackathon · Saturday · Yaba")).toBe(true);
    expect(readsAsList("Hackathon — Saturday; Yaba")).toBe(true);
    expect(readsAsList("Doors at 9.30am, talks from 10am")).toBe(false);
  });
});

/* Round-6 live run, r1-upload: "Order ahead for pickup" under an "Order
   Ahead" button, which the model did not mark. */
describe("dropButtonEchoes", () => {
  const brief =
    "Strawberry mille-feuille, ₦4,500 a slice, from Monday. Order ahead; pickup from 7am.";
  const facts = settleBriefFacts(
    [
      { kind: "time", text: "pickup from 7am" },
      { kind: "day", text: "from Monday" },
    ],
    brief,
    { region: "NG" },
  ).facts;
  const direction = {
    headline: "Strawberry Mille-Feuille",
    subheadline: "Laminated pastry and strawberries. ₦4,500 a slice.",
    cta: "Order Ahead",
    footerLines: [
      "Available from Monday · Pickup from 7am",
      "Order ahead for pickup",
    ],
    footerStyle: "text" as const,
  };

  it("drops an item that only says the button's action again", () => {
    const { directions, outcomes } = dropButtonEchoes([direction], facts);
    expect(directions[0].footerLines).toEqual([
      "Available from Monday · Pickup from 7am",
    ]);
    expect(outcomes).toEqual([
      expect.objectContaining({
        item: "Order ahead for pickup",
        dropped: true,
        repeats: "the button's action",
      }),
    ]);
  });

  it("keeps an item carrying a brief fact the button does not state", () => {
    const { directions } = dropButtonEchoes(
      [
        {
          ...direction,
          cta: "Order for pickup",
          footerLines: ["Pickup from 7am"],
        },
      ],
      facts,
    );
    expect(directions[0].footerLines).toEqual(["Pickup from 7am"]);
  });

  it("keeps an item with nothing in common with the button", () => {
    const { directions } = dropButtonEchoes(
      [{ ...direction, footerLines: ["Lekki shop"] }],
      facts,
    );
    expect(directions[0].footerLines).toEqual(["Lekki shop"]);
  });
});

/* Oluwaseyi's ruling, round 6: with headline merges forbidden, a
   fact-carrying item may still merge, into a fresh subheadline. */
describe("a merge with no subheadline to carry it", () => {
  const facts = settleBriefFacts(
    [{ kind: "contact", text: "Call 0809 111 4462" }],
    "Same-day laundry. Call 0809 111 4462.",
    { region: "NG" },
  ).facts;
  const bare = {
    headline: "Back by 7pm",
    cta: "Call to book",
    footerLines: ["Call 0809 111 4462"],
    footerStyle: "text" as const,
  };

  it("asks again for a subheadline when the first answer gave a headline rewrite", () => {
    expect(
      marksNeedingRewrite(
        [bare],
        [
          {
            id: "0.0",
            repeats: "the button",
            field: "headline",
            rewrite: "Back by 7pm. Call 0809 111 4462",
          },
        ],
        facts,
      ),
    ).toEqual([{ id: "0.0", item: "Call 0809 111 4462" }]);
  });

  it("strips a headline field from the first answer", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        repeats: [
          {
            id: "0.0",
            repeats: "the button",
            field: "headline",
            rewrite: "Back by 7pm. Call 0809 111 4462",
          },
        ],
      },
    });
    expect(await checkFooterRepeats([bare])).toEqual([
      { id: "0.0", repeats: "the button" },
    ]);
  });

  it("writes a fresh subheadline carrying the detail, held like any merge", async () => {
    const holds = vi.fn(async () => true);
    const { directions, outcomes } = await settleMarkedRepeats(
      [bare],
      [
        {
          id: "0.0",
          repeats: "the button",
          field: "subheadline",
          rewrite: "Same-day laundry. Call 0809 111 4462.",
        },
      ],
      facts,
      holds,
    );
    expect(directions[0].headline).toBe("Back by 7pm");
    expect(directions[0]).toMatchObject({
      subheadline: "Same-day laundry. Call 0809 111 4462.",
      footerLines: [],
    });
    expect(outcomes[0].merged).toEqual({
      field: "subheadline",
      from: "",
      to: "Same-day laundry. Call 0809 111 4462.",
    });
    expect(holds).toHaveBeenCalledTimes(1);
  });

  it("keeps the item when the fresh subheadline does not hold", async () => {
    const { directions } = await settleMarkedRepeats(
      [bare],
      [
        {
          id: "0.0",
          repeats: "the button",
          field: "subheadline",
          rewrite: "Same-day laundry. Call 0809 111 4462.",
        },
      ],
      facts,
      async () => false,
    );
    expect(directions[0]).toEqual(bare);
  });
});

/* Round-6 code critic, r6-footer.log P4 to P6: drops and merges are held
   to the literal verifier, and an item a customer acts on is never dropped
   on a model's reading or a word-share rule unless it is said elsewhere. */
describe("drops that would lose what a customer acts on", () => {
  it("P4: a marked cut-off the reader missed stays", () => {
    const facts = settleBriefFacts(
      [
        { kind: "price", text: "₦15,000" },
        { kind: "contact", text: "WhatsApp 0803 555 0142" },
      ],
      "Cakes ₦15,000. Pre-orders close Thursday 6pm. WhatsApp 0803 555 0142.",
      { region: "NG" },
    ).facts;
    const design = {
      headline: "Cakes for the weekend",
      subheadline: "Order early this week.",
      cta: "WhatsApp to order",
      footerLines: [
        "₦15,000 · WhatsApp 0803 555 0142",
        "Pre-orders close Thursday 6pm",
      ],
      footerStyle: "text" as const,
    };
    const { directions, outcomes } = dropMarkedRepeats(
      [design],
      [{ id: "0.2", repeats: "order early" }],
      facts,
    );
    expect(directions[0].footerLines).toContain(
      "Pre-orders close Thursday 6pm",
    );
    expect(outcomes[0].dropped).toBe(false);
  });

  it("P5: a button echo naming a place stays", () => {
    const facts = settleBriefFacts(
      [{ kind: "price", text: "₦8,000 a tray" }],
      "Order ahead for pickup at our Lekki Phase 1 shop. Small chops ₦8,000 a tray.",
      { region: "NG" },
    ).facts;
    const { directions } = dropButtonEchoes(
      [
        {
          headline: "Party trays, sorted",
          subheadline: "Small chops for the weekend.",
          cta: "Order ahead for pickup",
          footerLines: [
            "₦8,000 a tray",
            "Order ahead for pickup in Lekki Phase 1",
          ],
          footerStyle: "text" as const,
        },
      ],
      facts,
    );
    expect(directions[0].footerLines).toContain(
      "Order ahead for pickup in Lekki Phase 1",
    );
  });

  it("P6: a merge that drops a place from the offer is refused", async () => {
    const facts = settleBriefFacts(
      [
        { kind: "offer", text: "Free delivery to Lekki, Ajah and Ikoyi" },
        { kind: "price", text: "₦15,000" },
      ],
      "Free delivery to Lekki, Ajah and Ikoyi this week. Cakes ₦15,000.",
      { region: "NG" },
    ).facts;
    const design = {
      headline: "Cakes at your door",
      subheadline: "₦15,000 cakes.",
      cta: "Order now",
      footerLines: ["Free delivery to Lekki, Ajah and Ikoyi"],
      footerStyle: "text" as const,
    };
    const { directions } = await settleMarkedRepeats(
      [design],
      [
        {
          id: "0.0",
          repeats: "delivery",
          field: "subheadline",
          rewrite: "₦15,000 cakes, with free delivery in Lekki and Ajah.",
        },
      ],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(design);
  });
});

describe("the repeat checker reads a long explanation", () => {
  it("cuts it instead of losing the whole reading", async () => {
    generateObject.mockResolvedValueOnce({
      object: { repeats: [{ id: "0.0", repeats: "x".repeat(400) }] },
    });
    const out = await checkFooterRepeats([
      {
        headline: "Step away",
        footerLines: ["Free registration"],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out?.[0].repeats).toHaveLength(200);
  });

  it("asks for footer items repeating each other, in a clean sentence", () => {
    const prompt = buildFooterRepeatPrompt([
      { headline: "h", footerLines: ["a · b"] },
    ]);
    expect(prompt).toContain("another of its footer items");
    expect(prompt).not.toMatch(/stays an action: it stays an action/);
  });
});

/* Round-7 eval, fitness: "Book on WhatsApp" under "WhatsApp to Book" was
   kept because it carries a fact, one the button already states. */
it("drops a button echo whose fact the button states", () => {
  const facts = settleBriefFacts(
    [{ kind: "contact", text: "book on WhatsApp" }],
    "6am HIIT every weekday. First class free, book on WhatsApp.",
    { region: "NG" },
  ).facts;
  const { directions } = dropButtonEchoes(
    [
      {
        headline: "Your first class is free",
        cta: "WhatsApp to Book",
        footerLines: ["Book on WhatsApp"],
        footerStyle: "text" as const,
      },
    ],
    facts,
  );
  expect(directions[0].footerLines).toEqual([]);
});

/* Round-7 code critic, D1 to D4: contacts with no digits, and a place
   after "to", were dropped as button echoes when the reader missed them. */
describe("button echoes that carry a contact or a place", () => {
  it.each([
    ["D1", "DM @adabags to order", "DM to order"],
    ["D2", "Email hello@adaevents.ng", "Email us"],
    ["D3", "Shop online at adabags.ng", "Shop online"],
    ["D4", "Order for delivery to Ikoyi", "Order for delivery"],
  ])("%s keeps %s under %s", (_id, item, button) => {
    const { directions } = dropButtonEchoes(
      [
        {
          headline: "Ankara totes",
          cta: button,
          footerLines: [item],
          footerStyle: "text" as const,
        },
      ],
      [],
    );
    expect(directions[0].footerLines).toEqual([item]);
  });
});
