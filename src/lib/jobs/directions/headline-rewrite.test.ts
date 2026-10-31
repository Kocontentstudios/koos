// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const {
  buildHeadlineRewritePrompt,
  recoverHeadline,
  RECOVERED_HEADLINES_ASKED,
  rewriteHeadline,
  REWRITTEN_HEADLINE_MAX,
} = await import("./headline-rewrite");

const input = {
  headline: "Order your strawberry mille-feuille from 7am.",
  subheadline: "Order our strawberry mille-feuille ahead. ₦4,500 a slice.",
  cta: "Order Ahead",
  others: ["Strawberry Mille-Feuille"],
  avoid: ["strawberry", "mille-feuille"],
  briefText:
    "Launch our strawberry mille-feuille, ₦4,500 a slice, from Monday. Pickup from 7am.",
  title: "Strawberry mille-feuille launch",
};

beforeEach(() => generateObject.mockReset());

describe("rewriteHeadline", () => {
  it("asks for a different idea, without the shared words or new facts", () => {
    const prompt = buildHeadlineRewritePrompt(input);
    expect(prompt).toContain(input.briefText);
    expect(prompt).toContain(
      "The other design's headline: Strawberry Mille-Feuille",
    );
    expect(prompt).toContain(
      "Do not use these words: strawberry, mille-feuille.",
    );
    expect(prompt).toMatch(/State nothing the brief does not/);
    expect(prompt).toContain(`at most ${REWRITTEN_HEADLINE_MAX} characters`);
  });

  it("returns the short headlines it wrote, tidied", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        headlines: [
          "  Your 7am   pickup stop ",
          "A whole morning's worth of reasons to stop by on the way to work",
          "",
        ],
      },
    });
    expect(await rewriteHeadline(input)).toEqual(["Your 7am pickup stop"]);
  });

  it("is unavailable, not empty, when the call fails", async () => {
    generateObject.mockRejectedValueOnce(new Error("throttled"));
    expect(await rewriteHeadline(input)).toBeNull();
  });
});

/* Round-14 code critic, finding 4: the schema capped the array at five and
   each headline at 120 characters, so a sixth or an over-long one failed
   the whole call and the direction was lost as an outage. The mock parses
   with the call's own schema, as generateObject does. */
describe("a model answer the schema did not expect", () => {
  const recoveryInput = {
    refused: [
      { headline: "Can African cities beat the heat?", why: "a claim" },
    ],
    subheadline: "Two days of talks on cooler cities",
    cta: "Get tickets",
    others: ["Cooler cities start here"],
    briefText: "A conference on heat in African cities.",
    title: "Heat conference",
  };
  const answering = (headlines: string[]) =>
    generateObject.mockImplementationOnce(
      async (o: { schema: { parse: (v: unknown) => unknown } }) => ({
        object: o.schema.parse({ headlines }),
      }),
    );
  const long = `A ${"very ".repeat(30)}long headline`;

  it("keeps the first five recovered headlines, over-long ones included for the caller to refuse by name", async () => {
    answering(["One", "Two", long, "Four", "Five", "Six"]);
    const got = await recoverHeadline(recoveryInput);
    expect(got).toEqual(["One", "Two", long, "Four", "Five"]);
    expect(got).toHaveLength(RECOVERED_HEADLINES_ASKED);
  });

  it("keeps the rewrites that fit when one is over-long or a sixth comes back", async () => {
    answering(["Your 7am pickup stop", long, "b", "c", "d", "e"]);
    expect(await rewriteHeadline(input)).toEqual([
      "Your 7am pickup stop",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});
