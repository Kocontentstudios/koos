// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FactWriter } from "./fact-writer";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { aboveRepeats, headlineInTheWay } = await import("./brief-facts");
type BriefFact = import("./brief-facts").BriefFact;
type FactCopy = import("./brief-facts").FactCopy;
const { factLedger } = await import("./claims");
const { buildFactWritePrompt, headlineFault, rewriteFault, settleFacts } =
  await import("./fact-writer");
const { directionOverlap, distinctiveWords, isNearDuplicate, contentStems } =
  await import("./text-overlap");

/* The round-8 eval at 653f975: a headline that paraphrases a fact the
   literal verifier needs whole below it ("Senior React Engineers Wanted"
   over "two senior React engineers"), a named speaker left off twice as
   "reads like the other design", and two rewrites taken in one round that
   made the fitness pair one design. */

const fact = (kind: BriefFact["kind"], text: string, needs: string[]) =>
  ({ kind, text, needs }) as BriefFact;
const passing = async () => [];

const hiring =
  "We're hiring two senior React engineers, fully remote anywhere in Africa. Apply by 30 November.";
const hiringFacts = [
  fact("product", "senior React engineers", ["^senior", "^react", "^engineer"]),
  fact("quantity", "two senior React engineers", [
    "=2",
    "^senior",
    "^react",
    "^engineer",
  ]),
  fact("place", "fully remote anywhere in Africa", ["^remote", "^africa"]),
];
const wanted: FactCopy = {
  headline: "Senior React Engineers Wanted",
  subheadline: "Fully remote, anywhere in Africa.",
  cta: "Apply",
  footerLines: [],
  footerStyle: "none",
};

describe("headlineInTheWay", () => {
  it("is true when stating a missing fact whole would repeat the headline", () => {
    expect(headlineInTheWay(wanted, hiringFacts)).toBe(true);
  });

  it("is true when the subheadline already repeats the headline", () => {
    expect(
      headlineInTheWay(
        {
          headline: "Zero fees. 20 countries.",
          subheadline: "Send money to 20 African countries.",
          footerLines: [],
        },
        [],
      ),
    ).toBe(true);
  });

  it("is false for a headline on its own idea", () => {
    expect(
      headlineInTheWay(
        { ...wanted, headline: "Build Africa's payment rails" },
        hiringFacts,
      ),
    ).toBe(false);
  });

  it("is false when only the button is repeated", () => {
    expect(
      headlineInTheWay(
        {
          headline: "Espresso, three ways",
          subheadline: "Weekdays from 8am.",
          cta: "Walk in from 8am",
          footerLines: [],
        },
        [],
      ),
    ).toBe(false);
  });
});

describe("the fact writer moves a headline only out of a fact's way", () => {
  it("takes a headline that states the fact, with the subheadline clear of it", async () => {
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        headline: "Two Senior React Engineers Wanted",
        subheadline: "Fully remote, anywhere in Africa.",
        footerLines: [],
      },
    ]);
    const claimCheck = vi.fn(async () => []);
    const out = await settleFacts({
      directions: [wanted],
      facts: hiringFacts,
      ledger: factLedger([hiring]),
      writer,
      claimCheck,
      briefText: hiring,
      title: "",
    });
    expect(writer.mock.calls[0][0].requests[0].headlineMayChange).toBe(true);
    expect(out.directions[0]).toMatchObject({
      headline: "Two Senior React Engineers Wanted",
      cta: "Apply",
    });
    expect(aboveRepeats(out.directions[0])).toEqual([]);
    expect(out.headlines).toEqual([
      {
        direction: 0,
        from: "Senior React Engineers Wanted",
        to: "Two Senior React Engineers Wanted",
      },
    ]);
    expect(out.leftOff).toEqual([]);
    /* The new headline is claim-checked like every rewritten field. */
    expect(claimCheck.mock.calls[0]).toEqual([
      [
        expect.objectContaining({
          id: "0.headline",
          field: "headline",
          text: "Two Senior React Engineers Wanted",
        }),
      ],
    ]);
  });

  it("never takes a headline the claim check flags, or any while it is down", async () => {
    const answer = async () => [
      {
        id: 0,
        headline: "Two Senior React Engineers Wanted Now",
        subheadline: "Fully remote, anywhere in Africa.",
        footerLines: [],
      },
    ];
    for (const claimCheck of [
      async () => [{ id: "0.headline", statement: "Now" }],
      async () => null,
    ]) {
      const out = await settleFacts({
        directions: [wanted],
        facts: hiringFacts,
        ledger: factLedger([`${hiring} now`]),
        writer: answer,
        claimCheck,
        briefText: hiring,
        title: "",
      });
      expect(out.directions[0].headline).toBe(wanted.headline);
      expect(out.headlines).toEqual([]);
    }
  });

  it("ignores a headline sent for a direction whose headline is not in the way", async () => {
    const free = { ...wanted, headline: "Build Africa's payment rails" };
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        headline: "Two senior React engineers",
        subheadline: "We're hiring two senior React engineers, fully remote.",
        footerLines: [],
      },
    ]);
    const out = await settleFacts({
      directions: [free],
      facts: hiringFacts,
      ledger: factLedger([hiring]),
      writer,
      claimCheck: passing,
      briefText: hiring,
      title: "",
    });
    expect(writer.mock.calls[0][0].requests[0].headlineMayChange).toBe(
      undefined,
    );
    expect(out.directions[0].headline).toBe("Build Africa's payment rails");
  });

  it("refuses a new headline off the old idea, and says why", () => {
    expect(
      headlineFault(
        wanted,
        { ...wanted, headline: "Payments infrastructure across a continent" },
        hiringFacts,
        factLedger([`${hiring} payments infrastructure across a continent`]),
      ),
    ).toMatch(/drops the headline's idea/);
  });

  it("refuses a new headline the subheadline still repeats", () => {
    expect(
      headlineFault(
        wanted,
        {
          ...wanted,
          headline: "Two Senior React Engineers Wanted",
          subheadline: "Two senior React engineers, fully remote.",
        },
        hiringFacts,
        factLedger([hiring]),
      ),
    ).toMatch(/still says what the new headline says/);
  });

  it("names the fact a new headline still stands in the way of", () => {
    expect(
      headlineFault(
        wanted,
        { ...wanted, headline: "Senior React Engineers, Remote" },
        hiringFacts,
        factLedger([hiring]),
      ),
    ).toMatch(
      /"two senior React engineers" is still not stated and saying it below would repeat the new headline/,
    );
  });

  it("refuses a new headline over its limit", () => {
    expect(
      headlineFault(
        wanted,
        { ...wanted, headline: `Two Senior React Engineers ${"x".repeat(80)}` },
        hiringFacts,
        factLedger([hiring]),
      ),
    ).toMatch(/headline: \d+ characters/);
  });

  it("refuses any rewrite that changes the button", () => {
    expect(
      rewriteFault(
        wanted,
        { ...wanted, cta: "Apply today" },
        hiringFacts,
        factLedger([hiring]),
      ),
    ).toBe("the button changed");
  });

  it("refuses a new headline that makes the pair one design", async () => {
    const other: FactCopy = {
      headline: "Two Senior React Engineers Wanted",
      subheadline: "Apply by 30 November.",
      footerLines: [],
      footerStyle: "none",
    };
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        headline: "Two Senior React Engineers Wanted",
        subheadline: "Fully remote, anywhere in Africa.",
        footerLines: [],
      },
    ]);
    const out = await settleFacts({
      directions: [wanted, other],
      facts: hiringFacts.slice(0, 2),
      ledger: factLedger([hiring]),
      writer,
      claimCheck: passing,
      briefText: hiring,
      title: "",
      keepsApart: (set) => set[0].headline !== set[1].headline,
    });
    expect(out.directions[0].headline).toBe(wanted.headline);
  });

  it("tells the model which designs may move their headline, and the limit", () => {
    const prompt = buildFactWritePrompt({
      requests: [
        {
          id: 0,
          copy: wanted,
          missing: ["two senior React engineers"],
          keep: [],
          problems: [],
          headlineMayChange: true,
        },
      ],
      briefText: hiring,
      title: "",
    });
    expect(prompt).toContain("Never change the button");
    expect(prompt).toContain("  headline may change");
    expect(prompt).toMatch(/at most 50 characters/);
  });
});

describe("a pair kept apart across one round of rewrites", () => {
  const fitness =
    "New 6am HIIT class every weekday at our Yaba studio. Your first class is free; book on WhatsApp.";
  const briefWords = contentStems(fitness);
  const hiit = [fact("product", "HIIT class", ["^hiit", "^class"])];
  const pair: FactCopy[] = [
    {
      headline: "6am HIIT. Every Weekday.",
      subheadline: "Your first class is free. Hit the studio before work.",
      cta: "Book on WhatsApp",
      footerLines: [],
      footerStyle: "none",
    },
    {
      headline: "Your First Class Is Free",
      subheadline: "6am every weekday in Yaba.",
      cta: "Book on WhatsApp",
      footerLines: [],
      footerStyle: "none",
    },
  ];
  const comparable = (d: FactCopy) => ({
    ...d,
    title: "",
    backgroundPrompt: "",
  });
  const keepsApart = (set: FactCopy[]) =>
    !isNearDuplicate(
      directionOverlap(comparable(set[0]), comparable(set[1]), {
        compareScenes: false,
        briefWords,
      }),
    );
  const wordsOfOthers = (set: FactCopy[], id: number) =>
    distinctiveWords(
      set
        .filter((_, j) => j !== id)
        .flatMap((d) => [d.headline, d.subheadline, d.cta])
        .join(" "),
      new Set([...briefWords, ...contentStems(set[id].cta)]),
    );

  /* Round-8 eval, fitness-ko run b: delivered at copy overlap 0.5. */
  it("takes the first of two rewrites that echo each other, and asks again for the second", async () => {
    const writer = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 0,
          subheadline:
            "Your first class is free — join our HIIT class before work.",
          footerLines: [],
        },
        {
          id: 1,
          subheadline: "Join our HIIT class at 6am every weekday in Yaba.",
          footerLines: [],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 1,
          subheadline: "A HIIT class at 6am every weekday in Yaba.",
          footerLines: [],
        },
      ]);
    expect(
      keepsApart([
        {
          ...pair[0],
          subheadline:
            "Your first class is free — join our HIIT class before work.",
        },
        {
          ...pair[1],
          subheadline: "Join our HIIT class at 6am every weekday in Yaba.",
        },
      ]),
    ).toBe(false);
    const out = await settleFacts({
      directions: pair,
      facts: hiit,
      ledger: factLedger([fitness]),
      writer,
      claimCheck: passing,
      briefText: fitness,
      title: "",
      keepsApart: (set) => keepsApart(pair) === false || keepsApart(set),
      wordsOfOthers,
    });
    expect(keepsApart(out.directions)).toBe(true);
    expect(out.directions[1].subheadline).toBe(
      "A HIIT class at 6am every weekday in Yaba.",
    );
    const second = writer.mock.calls[1][0].requests[0];
    expect(second.id).toBe(1);
    expect(second.avoid).toContain("join");
    expect(second.problems).toContainEqual(
      expect.stringMatching(/reads like the other design \(both say "join"\)/),
    );
    expect(out.leftOff).toEqual([]);
  });
});

describe("the other design's words", () => {
  /* Round-8 eval, conference-ko run a: "With architect Ada Obi" left off
     direction 0 twice as "it reads like the other design", whose copy said
     "Join the conversation" and "Ada Obi leads ...". */
  it("are named to the writer up front, beyond the brief's and the button's", async () => {
    const brief =
      "Announce our panel 'Building for Heat' with architect Ada Obi, Friday 14 March at 4pm, Landmark Centre. Free registration, limited seats.";
    const set: FactCopy[] = [
      {
        headline: "Building for Heat",
        cta: "Register Free",
        footerLines: ["Friday 14 March · Landmark Centre"],
        footerStyle: "text",
      },
      {
        headline: "Join the conversation",
        subheadline: "Ada Obi leads Building for Heat on Friday 14 March.",
        cta: "Register Free",
        footerLines: [],
        footerStyle: "none",
      },
    ];
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => []);
    await settleFacts({
      directions: set,
      facts: [fact("person", "With architect Ada Obi", ["^ada", "^obi"])],
      ledger: factLedger([brief]),
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "Panel announcement",
      wordsOfOthers: (directions, id) =>
        distinctiveWords(
          directions
            .filter((_, j) => j !== id)
            .flatMap((d) => [d.headline, d.subheadline, d.cta])
            .join(" "),
          new Set([
            ...contentStems(`${brief} Panel announcement`),
            ...contentStems(directions[id].cta),
          ]),
        ),
    });
    const request = writer.mock.calls[0][0].requests[0];
    expect(request.avoid).toEqual(["join", "conversation", "leads"]);
    expect(buildFactWritePrompt(writer.mock.calls[0][0])).toContain(
      `the other design's own words, not to use: "join", "conversation", "leads"`,
    );
  });
});

describe("a rewrite whose footer echoes the copy above", () => {
  /* Round-8 eval, retreat-sky-upload run b: three facts refused for one
     footer item saying the button again. */
  it("is taken without the echo when that loses nothing", async () => {
    const brief =
      "Weekend yoga retreat outside Ibadan, Friday 12 December to Sunday 14 December. ₦120,000 per person. Book at stillwater.ng.";
    const facts = [
      fact("place", "outside Ibadan", ["^ibadan"]),
      fact("date", "Friday 12 December to Sunday 14 December", [
        "=12",
        "=14",
        "~friday",
        "~sunday",
        "~dec",
      ]),
      fact("contact", "stillwater.ng", ["^stillwater.ng"]),
    ];
    const before: FactCopy = {
      headline: "Step away for a weekend",
      subheadline: "A small-group yoga retreat for the weekend.",
      cta: "Book at stillwater.ng",
      footerLines: [],
      footerStyle: "none",
    };
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        subheadline: "A small-group yoga retreat outside Ibadan.",
        footerLines: [
          "Friday 12 December to Sunday 14 December",
          "Book at stillwater.ng",
        ],
      },
    ]);
    const out = await settleFacts({
      directions: [before],
      facts,
      ledger: factLedger([brief]),
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toMatchObject({
      subheadline: "A small-group yoga retreat outside Ibadan.",
      footerLines: ["Friday 12 December to Sunday 14 December"],
    });
    expect(out.added.map((a) => a.fact)).toEqual([
      "outside Ibadan",
      "Friday 12 December to Sunday 14 December",
    ]);
  });
});

describe("distinctiveWords", () => {
  it("keeps one word per stem beyond the excluded stems, as written", () => {
    expect(
      distinctiveWords(
        "Join the conversation. Joining us? Ada Obi leads.",
        contentStems("Ada Obi"),
      ),
    ).toEqual(["join", "conversation", "leads"]);
  });
});

describe("a rewrite taken in part", () => {
  /* Round-8 eval, pottery-evening-ko run b: a partial take cleared why the
     rest was refused, so the next ask did not say it. */
  it("tells the next ask why the rest was refused", async () => {
    const free = {
      ...wanted,
      headline: "Build Africa's payment rails",
      subheadline: "Fully remote, anywhere in Africa.",
    };
    const facts = [
      ...hiringFacts.slice(1),
      fact("date", "Apply by 30 November", ["=30", "~nov"]),
    ];
    const writer = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 0,
          subheadline: "Two senior React engineers, hired today, fully remote.",
          footerLines: ["Apply by 30 November"],
        },
      ])
      .mockResolvedValueOnce([]);
    const out = await settleFacts({
      directions: [free],
      facts,
      ledger: factLedger([hiring]),
      writer,
      claimCheck: passing,
      briefText: hiring,
      title: "",
    });
    expect(out.directions[0].footerLines).toEqual(["Apply by 30 November"]);
    expect(writer.mock.calls[1][0].requests[0].problems).toContainEqual(
      expect.stringMatching(
        /your last rewrite was refused: subheadline: .*today/,
      ),
    );
  });
});
