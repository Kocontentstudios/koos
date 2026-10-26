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
        kept: expect.stringMatching(/carries a brief fact said nowhere else/),
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
