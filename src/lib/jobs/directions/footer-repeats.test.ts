// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const {
  buildFooterRepeatPrompt,
  checkFooterRepeats,
  dropMarkedRepeats,
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
        kept: "it carries a brief fact said nowhere else",
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

  it("keeps the button short: a long merged button is refused", async () => {
    const { directions, outcomes } = await settleMarkedRepeats(
      [direction],
      [
        {
          id: "0.0",
          repeats: "the button",
          field: "button",
          rewrite: "WhatsApp 0813 222 7045 to Book",
        },
      ],
      facts,
      async () => true,
    );
    expect(directions[0]).toEqual(direction);
    expect(outcomes[0].kept).toMatch(/would not fit/);
  });
});
