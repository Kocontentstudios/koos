import { describe, expect, it } from "vitest";
import { contrastingDraft, draftOf } from "./fixtures";
import { repairDirectionsText } from "./repair";
import { directionsResponseSchema } from "./schema";

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

  it("shortens text that overshoots a hard spec limit at a word boundary", async () => {
    const long = [
      draftOf({
        cta: "Book your free first class on WhatsApp",
        headline:
          "Six in the morning, every weekday, at our Yaba studio: the hardest forty-five minutes",
        footerLines: [
          "Studio 4, 12 Herbert Macaulay Way, Yaba, Lagos, opposite the Unilag gate",
          "b",
          "c",
          "d",
        ],
      }),
      contrastingDraft(),
    ];
    const repaired = await repairDirectionsText({
      text: JSON.stringify({ directions: long }),
    });
    expect(valid(repaired)).toBe(true);
    const [first] = JSON.parse(repaired as string).directions;
    expect(first.cta).toBe("Book your free first class");
    expect("Book your free first class on WhatsApp".startsWith(first.cta)).toBe(
      true,
    );
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
