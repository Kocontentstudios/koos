// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FactWriter } from "./fact-writer";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { settleBriefFacts } = await import("./brief-facts");
const { factLedger } = await import("./claims");
const {
  buildFactWritePrompt,
  copyProblems,
  rewriteFault,
  settleFacts,
  writeFacts,
} = await import("./fact-writer");

/* Oluwaseyi's ruling, round 7: the model writes what a direction leaves
   out, code verifies it, and nothing is appended by code. */

const brief =
  "Three line cooks for our new Ikoyi kitchen. ₦220,000 a month plus staff meals. Two senior React engineers wanted. CV to jobs@emberandoak.ng by 15 November.";
const facts = settleBriefFacts(
  [
    { kind: "price", text: "₦220,000 a month" },
    { kind: "contact", text: "jobs@emberandoak.ng" },
  ],
  brief,
  { region: "NG" },
).facts;
const ledger = factLedger([brief]);

const direction = {
  headline: "Cook over real fire",
  subheadline: "Join our new Ikoyi kitchen.",
  cta: "Send your CV",
  footerLines: ["Two"],
  footerStyle: "text" as const,
};

const passing = async () => [];

beforeEach(() => generateObject.mockReset());

describe("copyProblems", () => {
  it("names a fragment, a time on a phone's line and a list", () => {
    expect(
      copyProblems({
        subheadline: "A day at the loom. Bring your own loom. Certificates.",
        footerLines: ["Two", "Call 0705 919 2284 · 9am to 4pm"],
      }),
    ).toEqual([
      expect.stringMatching(/reads as a list/),
      expect.stringMatching(/"Two" is a fragment/),
      expect.stringMatching(/puts a time beside a phone number/),
    ]);
  });
});

describe("copyProblems, round 8", () => {
  it("asks the writer to state once a footer item the copy above says", () => {
    expect(
      copyProblems({
        headline: "Twelve throws and cushions. One artisan each.",
        footerLines: ["Twelve throws and cushions"],
      }),
    ).toContainEqual(
      expect.stringMatching(/says again what the copy above says/),
    );
  });

  it("asks the writer to fix a subheadline repeating the headline", () => {
    expect(
      copyProblems({
        headline: "Your first 3 rides are free",
        subheadline: "Your first 3 rides are free in Lagos.",
        footerLines: [],
      }),
    ).toContainEqual(
      expect.stringMatching(/repeats a number from the headline/),
    );
  });
});

describe("settleFacts", () => {
  it("takes a rewrite that states what was missing and fixes the fragment", async () => {
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        subheadline: "Join our new Ikoyi kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toMatchObject({
      headline: "Cook over real fire",
      cta: "Send your CV",
      subheadline: "Join our new Ikoyi kitchen for ₦220,000 a month.",
      footerLines: ["CV to jobs@emberandoak.ng"],
    });
    expect(out.added.map((a) => a.fact)).toEqual([
      "₦220,000 a month",
      "jobs@emberandoak.ng",
    ]);
    expect(out.leftOff).toEqual([]);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer.mock.calls[0][0].requests[0]).toMatchObject({
      missing: ["₦220,000 a month", "jobs@emberandoak.ng"],
      problems: [expect.stringMatching(/"Two" is a fragment/)],
    });
  });

  it("takes a partial rewrite, then asks once more for the price with its unit", async () => {
    const writer = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 0,
          subheadline: "Join our new Ikoyi kitchen. ₦220,000.",
          footerLines: ["CV to jobs@emberandoak.ng"],
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 0,
          subheadline: "Join our new Ikoyi kitchen, ₦220,000 a month.",
          footerLines: ["CV to jobs@emberandoak.ng"],
        },
      ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(writer).toHaveBeenCalledTimes(2);
    /* The first answer stated the email, so it was taken; the second
       carries the price with its unit. */
    expect(out.directions[0].subheadline).toBe(
      "Join our new Ikoyi kitchen, ₦220,000 a month.",
    );
    expect(out.leftOff).toEqual([]);
  });

  it("never takes a rewrite that reads as a list or loses a fact", async () => {
    const stated = {
      ...direction,
      footerLines: ["CV to jobs@emberandoak.ng"],
    };
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline:
          "Join our new Ikoyi kitchen. ₦220,000 a month. Staff meals. Full-time.",
        footerLines: ["CV by 15 November"],
      },
    ]);
    const out = await settleFacts({
      directions: [stated],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toEqual(stated);
    expect(out.leftOff).toEqual([
      expect.objectContaining({
        fact: "₦220,000 a month",
        reason: expect.stringMatching(/refused/),
      }),
    ]);
  });

  it("takes nothing when the claim check is down", async () => {
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline: "Join our new Ikoyi kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: async () => null,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toEqual(direction);
    expect(out.leftOff.map((l) => l.reason)).toEqual([
      expect.stringMatching(/claim check could not be read/),
      expect.stringMatching(/claim check could not be read/),
    ]);
  });

  it("refuses a rewrite the claim check flags", async () => {
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline: "Join our spacious Ikoyi kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: async (fields) =>
        fields
          .filter((f) => f.text.includes("spacious"))
          .map((f) => ({ id: f.id })),
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toEqual(direction);
  });

  /* Round-7 live run: whole rewrites refused for a list-like subheadline
     left a price without its unit; the footer half is taken. */
  it("takes the footer half when the subheadline half fails", async () => {
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline:
          "Join our new Ikoyi kitchen. Staff meals. Full-time. Five days.",
        footerLines: ["₦220,000 a month", "CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toMatchObject({
      subheadline: direction.subheadline,
      footerLines: ["₦220,000 a month", "CV to jobs@emberandoak.ng"],
    });
    expect(out.leftOff).toEqual([]);
  });

  /* Round-7 eval, fitness and fintech: two rewrites came back as one
     sentence, and the pair read as one design. */
  it("refuses a rewrite that makes the pair one design, and says so", async () => {
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        subheadline: "Join our new Ikoyi kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
      keepsApart: () => false,
    });
    expect(out.directions[0]).toEqual(direction);
    expect(writer).toHaveBeenCalledTimes(2);
    expect(writer.mock.calls[1][0].requests[0].problems).toContainEqual(
      expect.stringMatching(/reads like the other design/),
    );
  });

  it("names what the claim check found when it asks again", async () => {
    const writer = vi.fn(async (_input: Parameters<FactWriter>[0]) => [
      {
        id: 0,
        subheadline: "Join our spacious kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: async (fields) =>
        fields
          .filter((f) => f.text.includes("spacious"))
          .map((f) => ({ id: f.id, statement: "spacious" })),
      briefText: brief,
      title: "",
    });
    expect(writer.mock.calls[1][0].requests[0].problems).toContainEqual(
      expect.stringMatching(/"spacious"/),
    );
  });

  it("shows the model the other design's subheadline not to echo", () => {
    const prompt = buildFactWritePrompt({
      requests: [
        {
          id: 1,
          copy: direction,
          missing: ["x"],
          keep: [],
          problems: [],
          others: ["Send money to 20 African countries."],
        },
      ],
      briefText: brief,
      title: "",
    });
    expect(prompt).toContain(
      'the other design\'s subheadline, not to echo: "Send money to 20 African countries."',
    );
  });

  /* The verifier refuses a value with another of its kind in its field
     (Oluwaseyi's ruling, 2026-10-28), so the writer is told the rule it
     is held to. */
  it("tells the model to give each time, price, date and count its own field", () => {
    const prompt = buildFactWritePrompt({
      requests: [
        { id: 0, copy: direction, missing: ["x"], keep: [], problems: [] },
      ],
      briefText: brief,
      title: "",
    });
    expect(prompt).toContain(
      "Give each time, price, date and count a field of its own",
    );
    expect(prompt).toContain('"10 seats · 18+" states no count');
  });

  it("asks nothing of a direction that is complete", async () => {
    const writer = vi.fn();
    const complete = {
      ...direction,
      subheadline: "₦220,000 a month in our new Ikoyi kitchen.",
      footerLines: ["CV to jobs@emberandoak.ng"],
    };
    const out = await settleFacts({
      directions: [complete],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(writer).not.toHaveBeenCalled();
    expect(out.modelCalls).toBe(0);
  });
});

/* Round-7 code critic, W5 to W7. */
describe("settleFacts guards what a rewrite removes", () => {
  it("W5: refuses a rewrite that drops a reader-missed cut-off", async () => {
    const withCutOff = {
      ...direction,
      footerLines: ["Pre-orders close Thursday 6pm"],
    };
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline: "Join our new Ikoyi kitchen for ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [withCutOff],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0].footerLines).toContain(
      "Pre-orders close Thursday 6pm",
    );
  });

  it("W6: refuses a list subheadline even when the draft was one", async () => {
    const listed = {
      ...direction,
      subheadline: "Ikoyi kitchen. Line cooks. Apply now.",
    };
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline: "Ikoyi kitchen. Line cooks. ₦220,000 a month.",
        footerLines: ["CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [listed],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0].subheadline).not.toBe(
      "Ikoyi kitchen. Line cooks. ₦220,000 a month.",
    );
  });

  it("W7: an empty answer keeps the subheadline", async () => {
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline: "",
        footerLines: ["₦220,000 a month", "CV to jobs@emberandoak.ng"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0].subheadline).toBe(direction.subheadline);
  });
});

describe("writeFacts", () => {
  it("asks for the subheadline and footer only, with the literal rules", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        rewrites: [
          { id: 0, subheadline: "s", footerLines: ["f"] },
          { id: 7, subheadline: "x", footerLines: [] },
        ],
      },
    });
    const input = {
      requests: [
        {
          id: 0,
          copy: direction,
          missing: ["₦220,000 a month"],
          keep: [],
          problems: [],
        },
      ],
      briefText: brief,
      title: "",
    };
    expect(await writeFacts(input)).toEqual([
      { id: 0, subheadline: "s", footerLines: ["f"] },
    ]);
    const prompt = buildFactWritePrompt(input);
    expect(prompt).toContain("Never change the button");
    expect(prompt).toContain('never "₦18,000" alone');
    expect(prompt).toContain('must state: "₦220,000 a month"');
    expect(prompt).toMatch(
      /Never put a time or opening hours on the same footer line as a phone number/,
    );
  });

  it("is unavailable, not empty, when the call fails", async () => {
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    expect(
      await writeFacts({
        requests: [
          { id: 0, copy: direction, missing: ["x"], keep: [], problems: [] },
        ],
        briefText: brief,
        title: "",
      }),
    ).toBeNull();
  });
});

/* Round-16 code critic, finding 3 (r16-cascade.mts): a wrong day in the
   headline, which the writer may not change, refused every rewrite of the
   other fields and told the writer to rewrite the headline. */
describe("a wrong day in a field the writer may not change", () => {
  const market =
    "Christmas market on Saturday 5 December at Lekki, closed on Sunday. Entry ₦2,000.";
  const marketFacts = settleBriefFacts(
    [
      { kind: "date", text: "Saturday 5 December" },
      { kind: "price", text: "₦2,000" },
    ],
    market,
    { region: "NG" },
  ).facts;
  const marketLedger = factLedger([market]);
  const before = {
    headline: "Sunday market, 5 December",
    subheadline: "Crafts, food and music in Lekki.",
    footerLines: [],
    footerStyle: "none" as const,
  };

  it("does not refuse a rewrite that adds the price and the right day below", () => {
    const fault = rewriteFault(
      before,
      {
        ...before,
        subheadline: "Crafts, food and music in Lekki. Entry ₦2,000.",
        footerLines: ["Saturday 5 December"],
        footerStyle: "text",
      },
      marketFacts,
      marketLedger,
    );
    expect(fault).toBeNull();
  });

  it("does not refuse a rewrite that adds only the price", () => {
    const fault = rewriteFault(
      before,
      {
        ...before,
        subheadline: "Crafts, food and music in Lekki. Entry ₦2,000.",
      },
      marketFacts,
      marketLedger,
    );
    expect(fault).toBeNull();
  });

  it("still refuses a rewrite that puts the wrong day in a field it may change", () => {
    const fault = rewriteFault(
      before,
      {
        ...before,
        subheadline: "Crafts on Sunday, 5 December. Entry ₦2,000.",
      },
      marketFacts,
      marketLedger,
    );
    expect(fault).toMatch(/the subheadline .* gives "5 December"/);
  });

  it("never asks the writer to rewrite the button for it", async () => {
    const writer = vi.fn<FactWriter>(async () => []);
    await settleFacts({
      directions: [
        {
          ...before,
          headline: "Christmas market",
          cta: "Book for Sunday 5 December",
        },
      ],
      facts: marketFacts,
      ledger: marketLedger,
      writer,
      claimCheck: passing,
      briefText: market,
      title: "",
    });
    const [request] = writer.mock.calls[0][0].requests;
    expect(request.problems.join(" ")).not.toMatch(/button/);
    expect(request.missing).toContain("Saturday 5 December");
  });

  it("asks for the headline only when the headline may change", async () => {
    const writer = vi.fn<FactWriter>(async () => []);
    await settleFacts({
      directions: [before],
      facts: marketFacts,
      ledger: marketLedger,
      writer,
      claimCheck: passing,
      briefText: market,
      title: "",
    });
    const [request] = writer.mock.calls[0][0].requests;
    const asksHeadline = request.problems.some((p) =>
      p.startsWith('the headline "Sunday market, 5 December"'),
    );
    expect(asksHeadline).toBe(request.headlineMayChange === true);
  });
});

/* Round-16 code critic, finding 7: a refused rewrite was logged by its
   reason alone, so a refusal could not be checked against the text. */
describe("a refused rewrite is traced with the model's text", () => {
  it("keeps what the model wrote beside why it was refused", async () => {
    const writer = vi.fn<FactWriter>(async () => [
      {
        id: 0,
        subheadline: "Cook over real fire in Ikoyi.",
        footerLines: ["Two"],
      },
    ]);
    const out = await settleFacts({
      directions: [direction],
      facts,
      ledger,
      writer,
      claimCheck: passing,
      briefText: brief,
      title: "",
    });
    expect(out.refused[0]).toEqual({
      direction: 0,
      why: expect.any(String),
      rewrite: {
        headline: "Cook over real fire",
        subheadline: "Cook over real fire in Ikoyi.",
        footerLines: ["Two"],
      },
    });
  });
});

/* Round-17 eval, textile store: two prices in one sentence state neither,
   and the writer, told only "must state ₦6,500 a yard", returned the
   sentence unchanged. It is told which value stands in the way. */
describe("a fact whose words stand beside a rival value", () => {
  const store =
    "We're back at Shop 12, Balogun Market. Ankara from ₦6,500 a yard, lace bundles ₦38,000 for 5 yards.";
  const storeFacts = settleBriefFacts(
    [
      { kind: "price", text: "₦6,500 a yard" },
      { kind: "price", text: "₦38,000 for 5 yards" },
    ],
    store,
    { region: "NG" },
  ).facts;
  const copy = {
    headline: "We're back",
    subheadline:
      "Ankara from ₦6,500 a yard and lace bundles at ₦38,000 for 5 yards.",
    footerLines: [],
    footerStyle: "none" as const,
  };

  it("names the field and asks for a field of the fact's own", async () => {
    const writer = vi.fn<FactWriter>(async () => []);
    await settleFacts({
      directions: [copy],
      facts: storeFacts,
      ledger: factLedger([store]),
      writer,
      claimCheck: passing,
      briefText: store,
      title: "",
    });
    const [request] = writer.mock.calls[0][0].requests;
    expect(request.problems).toContainEqual(
      expect.stringContaining(
        'gives "₦6,500 a yard" beside another value of its kind',
      ),
    );
    expect(request.problems).toContainEqual(
      expect.stringContaining('give "₦38,000 for 5 yards" a field'),
    );
  });

  it("takes a rewrite that gives each price its own field", async () => {
    const writer = vi.fn<FactWriter>(async () => [
      {
        id: 0,
        subheadline: "Ankara from ₦6,500 a yard.",
        footerLines: ["Lace bundles ₦38,000 for 5 yards"],
      },
    ]);
    const out = await settleFacts({
      directions: [copy],
      facts: storeFacts,
      ledger: factLedger([store]),
      writer,
      claimCheck: passing,
      briefText: store,
      title: "",
    });
    expect(out.leftOff).toEqual([]);
  });
});
