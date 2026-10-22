import { describe, expect, it } from "vitest";
import { contrastingDraft, draftOf } from "./fixtures";
import { repairDirectionsText, repairFitText } from "./repair";
import { DRAFT_LIMITS, directionsResponseSchema } from "./schema";

const pair = [draftOf(), contrastingDraft()];
const valid = (text: string | null) =>
  text !== null &&
  directionsResponseSchema(2).safeParse(JSON.parse(text)).success;

describe("repairDirectionsText", () => {
  it("unwraps directions the model returned as a JSON string", async () => {
    const text = JSON.stringify({ directions: JSON.stringify(pair) });
    expect(valid(await repairDirectionsText({ text }))).toBe(true);
  });

  it("wraps a bare array", async () => {
    const repaired = await repairDirectionsText({ text: JSON.stringify(pair) });
    expect(valid(repaired)).toBe(true);
  });

  /* Only past the parse limits, far beyond the contract: a 40-character
     button is left for the fit pass to rewrite whole, because a cut here
     would reach the design. */
  it("trims only text past the parse limits, at a word boundary", async () => {
    const runaway = `Book your free first class on WhatsApp ${"and bring a friend along ".repeat(4)}`;
    const long = [
      draftOf({
        cta: "Book your free first class on WhatsApp",
        subheadline: runaway.repeat(3),
        footerLines: ["a", "b", "c", "d"],
      }),
      contrastingDraft(),
    ];
    const repaired = await repairDirectionsText({
      text: JSON.stringify({ directions: long }),
    });
    expect(valid(repaired)).toBe(true);
    const [first] = JSON.parse(repaired as string).directions;
    expect(first.cta).toBe("Book your free first class on WhatsApp");
    expect(first.subheadline.length).toBeLessThanOrEqual(
      DRAFT_LIMITS.subheadline,
    );
    expect(runaway.repeat(3).startsWith(first.subheadline)).toBe(true);
    expect(first.footerLines).toHaveLength(3);
  });

  /* Through the real generateObject, so the repair is proved to run where
     the SDK actually calls it, not only as a function. */
  it("rescues the real generateObject call from the stringified answer", async () => {
    const { generateObject } = await import("ai");
    const { MockLanguageModelV3 } = await import("ai/test");
    const text = JSON.stringify({ directions: JSON.stringify(pair) });
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }),
    });
    const run = (repair?: typeof repairDirectionsText) =>
      generateObject({
        model,
        schema: directionsResponseSchema(2),
        prompt: "x",
        ...(repair ? { experimental_repairText: repair } : {}),
      });
    await expect(run()).rejects.toThrow();
    const { object } = await run(repairDirectionsText);
    expect(object.directions.map((d) => d.title)).toEqual(
      pair.map((d) => d.title),
    );
  });

  it.each([
    ["text that is not JSON", "here are your directions"],
    ["a string that is not an array", JSON.stringify({ directions: "two" })],
    ["an answer it cannot improve", JSON.stringify({ directions: pair })],
    ["a scalar", "7"],
  ])("leaves %s to fail", async (_label, text) => {
    expect(await repairDirectionsText({ text })).toBeNull();
  });
});

describe("repairFitText", () => {
  it("unwraps fixes returned as a JSON string", async () => {
    const fixes = [{ id: "0.cta", text: "Order ahead" }];
    const repaired = await repairFitText({
      text: JSON.stringify({ fixes: JSON.stringify(fixes) }),
    });
    expect(JSON.parse(repaired as string)).toEqual({ fixes });
  });

  /* The real answer from the round-2 eval's fitness case. */
  it("reads entries whose text carries unescaped quotes", async () => {
    const text = JSON.stringify({
      fixes:
        '[{"id": "1.rationale.1", "text": "The word "Free" appears in the headline so the offer registers immediately."}]',
    });
    const repaired = await repairFitText({ text });
    expect(JSON.parse(repaired as string)).toEqual({
      fixes: [
        {
          id: "1.rationale.1",
          text: 'The word "Free" appears in the headline so the offer registers immediately.',
        },
      ],
    });
  });

  it("leaves an answer it cannot read to fail", async () => {
    expect(await repairFitText({ text: "not json" })).toBeNull();
  });
});

describe("repairDirectionsText, round-2 probes", () => {
  /* u3-r2-code/repair-probe.log: each of these failed the whole job. */
  it("trims an answer with more directions than were asked for", async () => {
    const text = JSON.stringify({
      directions: [draftOf(), contrastingDraft()],
    });
    const repaired = await repairDirectionsText({ text, count: 1 });
    expect(
      directionsResponseSchema(1).safeParse(JSON.parse(repaired ?? "{}"))
        .success,
    ).toBe(true);
  });

  it("reads a rationale sent as one string and footer lines sent as null", async () => {
    const text = JSON.stringify({
      directions: [
        {
          ...draftOf(),
          rationale: "Names the croissant. Speaks to commuters.",
        },
        { ...contrastingDraft(), footerLines: null },
      ],
    });
    const repaired = await repairDirectionsText({ text, count: 2 });
    expect(valid(repaired)).toBe(true);
    expect(JSON.parse(repaired ?? "{}").directions[0].rationale).toEqual([
      "Names the croissant.",
      "Speaks to commuters.",
    ]);
  });
});
