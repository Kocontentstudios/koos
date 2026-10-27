// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { FactWriteRequest, FactWriter } from "./fact-writer";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { aboveRepeats, aboveRepeatsBy, headlineInTheWay } = await import(
  "./brief-facts"
);
type BriefFact = import("./brief-facts").BriefFact;
type FactCopy = import("./brief-facts").FactCopy;
const { factLedger } = await import("./claims");
const {
  buildFactWritePrompt,
  GENERAL_ASKS,
  repeatConflicts,
  settleFacts,
  TARGETED_ASKS,
} = await import("./fact-writer");

/* Round-8c eval at ddf3e3b: `aboveRepeats` read 4 and 2, a code footer
   repeat and a fragment were delivered, every one after both of the
   writer's asks were refused. Fixtures are the delivered copy and the
   job's own cover facts from /tmp/feat-033/u3-r6/eval-{a,b}-report.json. */

const fact = (kind: BriefFact["kind"], text: string, needs: string[]) =>
  ({ kind, text, needs }) as BriefFact;
const passing = async () => [];
type Answer = Awaited<ReturnType<FactWriter>>;

const bakeryBrief =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";
const bakeryFacts = [
  fact("product", "strawberry mille-feuille", [
    "^strawberry",
    "^mille",
    "^feuille",
  ]),
  fact("price", "₦4,500 a slice", ["=4500", "^slice"]),
  fact("day", "Monday", ["~monday"]),
  fact("condition", "order ahead for pickup", ["^ahead", "^pickup"]),
  fact("time", "from 7am", ["@420"]),
];
/* Run a, direction 0: the claim check's rewrite named the product under
   a headline that is the product's name. */
const bakery: FactCopy = {
  headline: "Strawberry Mille-Feuille",
  subheadline:
    "Commuters can order ahead for pickup — our strawberry mille-feuille is ₦4,500 a slice.",
  cta: "Order Ahead",
  footerLines: ["Available from Monday · Pickup from 7am"],
  footerStyle: "text",
};

const fintechBrief =
  "Send money to 20 African countries with zero transfer fees for your first month. Download the app to start.";
const fintechFacts = [
  fact("product", "Send money", ["^send", "^money"]),
  fact("quantity", "20 African countries", ["=20", "^african", "^country"]),
  fact("price", "zero transfer fees for your first month", [
    "^zero",
    "^transfer",
    "^fee",
    "^first",
    "^month",
  ]),
  fact("contact", "Download the app", ["^download", "^app"]),
];
/* Run a, direction 0: the headline paraphrases two facts the verifier
   needs whole below it. */
const fintech: FactCopy = {
  headline: "Send to Africa. Zero fees.",
  subheadline:
    "Send money to 20 African countries with zero transfer fees for your first month.",
  cta: "Download the app",
  footerLines: [],
  footerStyle: "none",
};

/**
 * The writer the two bakery runs met: it moves the headline whenever the
 * request lets it (and the move is refused, as both runs' were: "states
 * Fresh"), and only when the headline is fixed does it take the product's
 * name out of the subheadline.
 */
function bakeryWriter() {
  return vi.fn(async ({ requests }: Parameters<FactWriter>[0]) =>
    requests.map((r: FactWriteRequest) =>
      r.headlineMayChange
        ? {
            id: r.id,
            headline: "Fresh Strawberry Mille-Feuille",
            subheadline: "Order ahead for pickup, ₦4,500 a slice.",
            footerLines: r.copy.footerLines,
          }
        : {
            id: r.id,
            subheadline:
              "Commuters can order ahead for pickup, ₦4,500 a slice.",
            footerLines: r.copy.footerLines,
          },
    ),
  ) as unknown as FactWriter & ReturnType<typeof vi.fn>;
}

describe("a headline that already states its fact is not in its way", () => {
  it("leaves a product-name headline alone when the subheadline names the product again", () => {
    expect(aboveRepeats(bakery)).toEqual([
      "the subheadline says the headline again",
    ]);
    expect(headlineInTheWay(bakery, bakeryFacts)).toBe(false);
  });

  it("still moves a headline that paraphrases facts the subheadline must state whole", () => {
    expect(headlineInTheWay(fintech, fintechFacts)).toBe(true);
  });

  it("still moves one that says part of a fact the copy leaves out", () => {
    expect(
      headlineInTheWay(
        {
          headline: "Senior React Engineers Wanted",
          subheadline: "Fully remote, anywhere in Africa.",
          cta: "Apply",
          footerLines: [],
        },
        [
          fact("quantity", "two senior React engineers", [
            "=2",
            "^senior",
            "^react",
            "^engineer",
          ]),
        ],
      ),
    ).toBe(true);
  });
});

describe("the repeat is named in words the writer can act on", () => {
  it("gives the words both say, as the headline writes them", () => {
    expect(aboveRepeatsBy(bakery)).toEqual([
      {
        field: "headline",
        repeat: "the subheadline says the headline again",
        words: ["strawberry", "mille", "feuille"],
      },
    ]);
    expect(
      aboveRepeatsBy({
        headline: "A Tray for ₦13,500",
        subheadline: "Jollof for ten, ₦13,500 a tray.",
      })[0],
    ).toMatchObject({ field: "headline", words: ["₦13,500"] });
  });

  it("tells the subheadline to give the words up when the headline states the fact", () => {
    expect(repeatConflicts(bakery, bakeryFacts)).toEqual([
      'the headline already says "strawberry", "mille", "feuille"; leave those words out of the subheadline and give it only what the headline does not say',
    ]);
  });

  it("tells the headline to move when a fact below needs the words", () => {
    const [conflict] = repeatConflicts(fintech, fintechFacts);
    expect(conflict).toMatch(
      /^the subheadline says the headline's "send", "zero", "fees" again because it states "Send money", "zero transfer fees for your first month" whole; write the headline again without those words/,
    );
  });

  it("puts the named conflict in the ask, not the generic line", async () => {
    const writer = bakeryWriter();
    await settleFacts({
      directions: [bakery],
      facts: bakeryFacts,
      ledger: factLedger([bakeryBrief]),
      writer,
      claimCheck: passing,
      briefText: bakeryBrief,
      title: "",
    });
    const [request] = writer.mock.calls[0][0].requests;
    expect(request.headlineMayChange).toBeUndefined();
    expect(request.problems).toEqual([
      expect.stringMatching(/^the headline already says "strawberry"/),
    ]);
  });
});

describe("round-8c bakery replay: the subheadline gives up the product's name", () => {
  it("delivers no repeat, on the first ask, with every fact kept", async () => {
    const writer = bakeryWriter();
    const out = await settleFacts({
      directions: [bakery],
      facts: bakeryFacts,
      ledger: factLedger([bakeryBrief]),
      writer,
      claimCheck: passing,
      briefText: bakeryBrief,
      title: "",
    });
    expect(writer).toHaveBeenCalledTimes(1);
    expect(out.directions[0]).toMatchObject({
      headline: "Strawberry Mille-Feuille",
      subheadline: "Commuters can order ahead for pickup, ₦4,500 a slice.",
    });
    expect(aboveRepeats(out.directions[0])).toEqual([]);
    expect(out.leftOff).toEqual([]);
    expect(out.defectsLeft).toEqual([]);
  });
});

describe("a fault left after the general asks is asked about again", () => {
  /* Two answers that keep the repeat (as fintech's did in run a), then
     one that clears it. */
  const fintechWriter = () => {
    const stillRepeating: Answer = [
      {
        id: 0,
        headline: "Send money. Zero fees.",
        subheadline:
          "Send money to 20 African countries with zero transfer fees for your first month.",
        footerLines: [],
      },
    ];
    return vi
      .fn()
      .mockResolvedValueOnce(stillRepeating)
      .mockResolvedValueOnce(stillRepeating)
      .mockResolvedValueOnce([
        {
          id: 0,
          headline: "Move money across Africa",
          subheadline:
            "Send money to 20 African countries with zero transfer fees for your first month.",
          footerLines: [],
        },
      ]) as unknown as FactWriter & ReturnType<typeof vi.fn>;
  };

  it("clears the repeat on a targeted ask, naming the conflict", async () => {
    const writer = fintechWriter();
    const out = await settleFacts({
      directions: [fintech],
      facts: fintechFacts,
      ledger: factLedger([fintechBrief]),
      writer,
      claimCheck: passing,
      briefText: fintechBrief,
      title: "",
    });
    expect(writer).toHaveBeenCalledTimes(GENERAL_ASKS + 1);
    const targeted = writer.mock.calls[GENERAL_ASKS][0].requests[0];
    expect(targeted.subheadlineMayGo).toBe(true);
    expect(targeted.headlineMayChange).toBe(true);
    expect(targeted.problems).toEqual([
      expect.stringMatching(
        /^the subheadline says the headline's "send", "zero", "fees" again because it states/,
      ),
      expect.stringMatching(
        /^your last rewrite was refused: it states nothing more, and the headline already says "send", "money", "zero", "fees"/,
      ),
    ]);
    expect(out.directions[0].headline).toBe("Move money across Africa");
    expect(aboveRepeats(out.directions[0])).toEqual([]);
    expect(out.defectsLeft).toEqual([]);
  });

  it("asks only for directions with a fault once the general asks are spent", async () => {
    const clean: FactCopy = {
      headline: "Africa, one tap away",
      subheadline: "Send money to 20 African countries.",
      cta: "Download the app",
      footerLines: [],
      footerStyle: "none",
    };
    const writer = vi.fn(
      async (_input: Parameters<FactWriter>[0]) => [] as Answer,
    );
    await settleFacts({
      directions: [fintech, clean],
      facts: fintechFacts,
      ledger: factLedger([fintechBrief]),
      writer,
      claimCheck: passing,
      briefText: fintechBrief,
      title: "",
    });
    expect(writer).toHaveBeenCalledTimes(GENERAL_ASKS + TARGETED_ASKS);
    for (const call of writer.mock.calls.slice(0, GENERAL_ASKS)) {
      expect(call[0].requests.map((r: FactWriteRequest) => r.id)).toEqual([
        0, 1,
      ]);
    }
    for (const call of writer.mock.calls.slice(GENERAL_ASKS)) {
      expect(call[0].requests.map((r: FactWriteRequest) => r.id)).toEqual([0]);
    }
  });

  it("records what is still wrong when every ask is refused, and writes nothing itself", async () => {
    const writer = vi.fn(async () => [
      {
        id: 0,
        subheadline:
          "Send money to 20 African countries with zero transfer fees for your first month. Fresh and fast.",
        footerLines: [],
      },
    ]);
    const out = await settleFacts({
      directions: [fintech],
      facts: fintechFacts,
      ledger: factLedger([fintechBrief]),
      writer,
      claimCheck: passing,
      briefText: fintechBrief,
      title: "",
    });
    expect(writer).toHaveBeenCalledTimes(GENERAL_ASKS + TARGETED_ASKS);
    expect(out.directions[0]).toEqual(fintech);
    expect(out.defectsLeft).toEqual([
      {
        direction: 0,
        problem: expect.stringMatching(/says the headline again/),
      },
    ]);
  });
});

describe("a subheadline may go only when the ask says so", () => {
  const product: FactCopy = {
    headline: "Strawberry Mille-Feuille",
    subheadline: "Our strawberry mille-feuille, from Monday.",
    cta: "Order Ahead",
    footerLines: ["₦4,500 a slice · Order ahead for pickup from 7am"],
    footerStyle: "text",
  };

  it("drops it on a targeted ask once the footer carries what it said", async () => {
    const writer = vi.fn().mockResolvedValue([
      {
        id: 0,
        subheadline: "",
        footerLines: [
          "₦4,500 a slice · Order ahead for pickup from 7am",
          "Available from Monday",
        ],
      },
    ]) as unknown as FactWriter & ReturnType<typeof vi.fn>;
    const out = await settleFacts({
      directions: [product],
      facts: bakeryFacts,
      ledger: factLedger([bakeryBrief]),
      writer,
      claimCheck: passing,
      briefText: bakeryBrief,
      title: "",
    });
    /* The general asks keep the old subheadline for an empty answer
       (round-7 W7), so nothing changes until the targeted ask. */
    expect(writer).toHaveBeenCalledTimes(GENERAL_ASKS + 1);
    expect(out.directions[0].subheadline).toBeUndefined();
    expect(out.directions[0].footerLines).toEqual([
      "₦4,500 a slice · Order ahead for pickup from 7am",
      "Available from Monday",
    ]);
    expect(out.leftOff).toEqual([]);
    expect(out.defectsLeft).toEqual([]);
  });

  it("is told so in the prompt", () => {
    const prompt = buildFactWritePrompt({
      requests: [
        {
          id: 0,
          copy: product,
          missing: [],
          keep: [],
          problems: [],
          subheadlineMayGo: true,
        },
      ],
      briefText: bakeryBrief,
      title: "",
    });
    expect(prompt).toContain("  subheadline may go");
    expect(prompt).toContain('A design marked "subheadline may go"');
  });
});

describe("round-8c storefront replay: a claim-check flag refuses only its field", () => {
  const brief =
    "Our fabric shop reopens on Saturday 6 December. Ankara from ₦6,500 a yard and lace bundles at ₦38,000 for 5 yards. Shop 12, Balogun Market, Lagos Island, open 9am to 5pm. Call 0802 333 4567.";
  const facts = [
    fact("product", "Ankara", ["^ankara"]),
    fact("price", "₦38,000 for 5 yards", ["=38000", "=5", "^yard"]),
    fact("contact", "Call 0802 333 4567", ["#08023334567,2348023334567"]),
  ];
  /* Run b, direction 1: a bare phone in the footer. */
  const storefront: FactCopy = {
    headline: "Lace Bundles at ₦38,000",
    subheadline: "Ankara and lace, reopening Saturday 6 December.",
    cta: "Come Shop",
    footerLines: ["0802 333 4567"],
    footerStyle: "text",
  };
  const answer: Answer = [
    {
      id: 0,
      subheadline: "Ankara back in stock, reopening Saturday 6 December.",
      footerLines: ["Call 0802 333 4567"],
    },
  ];

  it("takes the footer that fixes the fragment, without the flagged subheadline", async () => {
    const out = await settleFacts({
      directions: [storefront],
      facts,
      ledger: factLedger([brief]),
      writer: vi.fn(async () => answer),
      claimCheck: async (fields) =>
        fields
          .filter((f) => f.text.includes("back in stock"))
          .map((f) => ({ id: f.id, statement: "back in stock" })),
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toEqual({
      ...storefront,
      footerLines: ["Call 0802 333 4567"],
    });
    expect(out.refused).toContainEqual({
      direction: 0,
      why: 'in part: the claim check found what the brief does not say: "back in stock"',
    });
    expect(out.defectsLeft).toEqual([]);
  });

  it("takes nothing while the claim check is down", async () => {
    const out = await settleFacts({
      directions: [storefront],
      facts,
      ledger: factLedger([brief]),
      writer: vi.fn(async () => answer),
      claimCheck: async () => null,
      briefText: brief,
      title: "",
    });
    expect(out.directions[0]).toEqual(storefront);
  });

  it("never keeps a new headline without the subheadline it was written for", async () => {
    const out = await settleFacts({
      directions: [fintech],
      facts: fintechFacts,
      ledger: factLedger([fintechBrief]),
      writer: vi.fn(async () => [
        {
          id: 0,
          headline: "Your first month costs nothing to move",
          subheadline:
            "Send money to 20 African countries with zero transfer fees for your first month, guaranteed.",
          footerLines: [],
        },
      ]),
      claimCheck: async (fields) =>
        fields
          .filter((f) => f.field === "subheadline")
          .map((f) => ({ id: f.id, statement: "guaranteed" })),
      briefText: fintechBrief,
      title: "",
    });
    expect(out.directions[0]).toEqual(fintech);
  });
});
