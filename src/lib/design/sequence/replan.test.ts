import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { CAFE_BRIEF, cafePlan } from "./fixtures";
import {
  applyFrameEdits,
  FrameEditError,
  FrameReplanError,
  replanFrame,
} from "./replan";

const context = directionsContext({
  title: "Cold brew launch",
  briefText: CAFE_BRIEF,
  designType: "Instagram carousel",
  brandSummary: { name: "Kiln Coffee", overview: "Coffee bar in Yaba, Lagos" },
});

const reader = vi.fn(async () => ({
  facts: [
    { kind: "price", text: "₦2,500 a bottle" },
    { kind: "date", text: "Saturday 15 November" },
    { kind: "time", text: "8am to 2pm" },
    { kind: "place", text: "our Yaba bar" },
    { kind: "contact", text: "WhatsApp 0803 555 0142" },
  ],
  offering: { kind: "product", phrase: "cold brew" },
  people: [],
}));

const rewrite = (over: Record<string, unknown> = {}) => ({
  object: {
    frames: [
      {
        frame: 2,
        title: "Price",
        headline: "Slow coffee, fair price",
        subheadline: "₦2,500 a bottle",
        footerLines: [],
        cta: "",
        ...over,
      },
    ],
  },
});

beforeEach(() => {
  generateObject.mockReset();
  reader.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("replanFrame with the user's edits", () => {
  const plan = cafePlan();

  it("draws the user's words exactly, with no model call", async () => {
    const result = await replanFrame(
      {
        context,
        plan,
        index: 1,
        edits: {
          headline: "Two bottles? ₦5,000!!",
          subheadline: "honestly worth it",
        },
      },
      { briefReader: reader },
    );
    expect(result.modelCalls).toBe(0);
    expect(result.beat.headline).toBe("Two bottles? ₦5,000!!");
    expect(result.beat.subheadline).toBe("honestly worth it");
    expect(generateObject).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });

  it("keeps role, title, layout, image, scene and footer", () => {
    const beat = applyFrameEdits(plan.frames[4], { headline: "See you there" });
    const { headline: _, ...kept } = beat;
    const { headline: __, ...before } = plan.frames[4];
    expect(kept).toEqual(before);
  });

  it("keeps a field the user left out, and clears one they emptied", () => {
    const beat = applyFrameEdits(plan.frames[0], { subheadline: "" });
    expect(beat.headline).toBe(plan.frames[0].headline);
    expect(beat.subheadline).toBe("");
  });

  it("only trims whitespace no one would see", () => {
    expect(
      applyFrameEdits(plan.frames[1], { headline: "  Hi there  " }).headline,
    ).toBe("Hi there");
  });

  it("refuses words past a frame's limit with a reason the user can act on", () => {
    const tooLong = "x".repeat(75);
    expect(() =>
      applyFrameEdits(plan.frames[1], { headline: tooLong }),
    ).toThrow(
      new FrameEditError(
        "The headline is 75 characters; a frame fits 70. Shorten it by 5.",
        "headline",
      ),
    );
    try {
      applyFrameEdits(plan.frames[4], { cta: "c".repeat(40) });
    } catch (err) {
      expect(err).toBeInstanceOf(FrameEditError);
      expect((err as FrameEditError).field).toBe("cta");
      expect((err as Error).message).toContain("button text is 40 characters");
    }
  });

  it("accepts words at exactly the limit", () => {
    const atLimit = "x".repeat(70);
    expect(
      applyFrameEdits(plan.frames[1], { headline: atLimit }).headline,
    ).toBe(atLimit);
  });

  it("refuses an empty headline", () => {
    expect(() => applyFrameEdits(plan.frames[1], { headline: "   " })).toThrow(
      "Every frame needs a headline.",
    );
  });

  it("refuses a button anywhere but the last frame, and the last without one", () => {
    expect(() => applyFrameEdits(plan.frames[2], { cta: "Buy" })).toThrow(
      FrameEditError,
    );
    expect(() => applyFrameEdits(plan.frames[4], { cta: "" })).toThrow(
      "The last frame needs its button text",
    );
    expect(applyFrameEdits(plan.frames[4], { cta: "Book now" }).cta).toBe(
      "Book now",
    );
  });
});

describe("replanFrame without edits", () => {
  const plan = cafePlan();

  it("rewrites one frame given its set, keeping its role and layout", async () => {
    generateObject.mockResolvedValue(rewrite());
    const result = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    );
    expect(result.modelCalls).toBe(2);
    expect(result.beat).toEqual({
      ...plan.frames[1],
      headline: "Slow coffee, fair price",
      subheadline: "₦2,500 a bottle",
    });
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Write frame 2 again");
    expect(prompt).toContain('"Your Saturday, slowed down"');
    expect(prompt).toContain(
      'It must state, in these words: "₦2,500 a bottle"',
    );
  });

  it("asks once more when the rewrite repeats a neighbour, then keeps the good one", async () => {
    generateObject
      .mockResolvedValueOnce(
        rewrite({ headline: "Your Saturday, slowed right down" }),
      )
      .mockResolvedValueOnce(rewrite());
    const result = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    );
    expect(result.modelCalls).toBe(3);
    const second = generateObject.mock.calls[1][0].prompt as string;
    expect(second).toContain("Your last attempt could not be used");
    expect(second).toContain("says what frame 1's");
    expect(result.beat.headline).toBe("Slow coffee, fair price");
  });

  it("refuses a rewrite that drops a fact only this frame stated", async () => {
    generateObject.mockResolvedValue(
      rewrite({ headline: "Worth every naira", subheadline: "" }),
    );
    const err = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FrameReplanError);
    expect((err as FrameReplanError).problems).toContain(
      'it no longer states "₦2,500 a bottle"',
    );
  });

  it("refuses a rewrite that says what the frame already said", async () => {
    generateObject.mockResolvedValue(
      rewrite({ frame: 4, headline: "Pour one at our Yaba bar today" }),
    );
    const err = await replanFrame(
      { context, plan, index: 3 },
      { briefReader: reader },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FrameReplanError);
  });

  it("refuses a number the brief never gave", async () => {
    generateObject.mockResolvedValue(
      rewrite({ subheadline: "₦2,500 a bottle · 40 bottles made" }),
    );
    const err = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(FrameReplanError);
    expect((err as FrameReplanError).message).toContain(
      "The frame is unchanged",
    );
  });

  it("keeps the button on the last frame and nowhere else", async () => {
    generateObject.mockResolvedValue(rewrite({ cta: "Buy now" }));
    const body = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    );
    expect(body.beat.cta).toBe("");
  });

  it("refuses an index outside the set", async () => {
    await expect(
      replanFrame({ context, plan, index: 7 }, { briefReader: reader }),
    ).rejects.toThrow(RangeError);
  });
});
