// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

const { buildHeadlineRewritePrompt, rewriteHeadline, REWRITTEN_HEADLINE_MAX } =
  await import("./headline-rewrite");

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
