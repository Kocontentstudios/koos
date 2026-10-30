import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (o: unknown) => generateObject(o) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { CAFE_BRIEF, CAFE_RULES, cafePlan, fact } from "./fixtures";
import {
  applyFrameEdits,
  FrameEditError,
  FrameReplanError,
  regenerateProblems,
  replanFrame,
  replanReason,
} from "./replan";
import { validateSequence } from "./validate";

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

const version = (over: Record<string, unknown> = {}) => ({
  frame: 2,
  title: "Price",
  headline: "Slow coffee, fair price",
  subheadline: "₦2,500 a bottle",
  footerLines: [],
  cta: "",
  ...over,
});

const rewrite = (over: Record<string, unknown> = {}) => ({
  object: { frames: [version(over)] },
});

const versions = (...overs: Record<string, unknown>[]) => ({
  object: { frames: overs.map(version) },
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
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.beat).toEqual({
      ...plan.frames[1],
      headline: "Slow coffee, fair price",
      subheadline: "₦2,500 a bottle",
    });
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain("Write frame 2 again, 2 different versions");
    expect(prompt).toContain('"Your Saturday, slowed down"');
    expect(prompt).toContain(
      'Each version states, in these words: "₦2,500 a bottle"',
    );
  });

  it("keeps the first version that stands beside its neighbours, in one call", async () => {
    generateObject.mockResolvedValue(
      versions({ headline: "Your Saturday, slowed right down" }, {}),
    );
    const result = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    );
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(result.modelCalls).toBe(2);
    expect(result.beat.headline).toBe("Slow coffee, fair price");
  });

  it("holds the frame to the facts the set was planned with, reading no brief", async () => {
    generateObject.mockResolvedValue(rewrite());
    const result = await replanFrame(
      { context, plan, index: 1 },
      {
        briefReader: reader,
        facts: [
          {
            kind: "price",
            text: "₦2,500 a bottle",
            needs: ["₦2,500"],
          },
        ],
        offering: "cold brew",
      },
    );
    expect(reader).not.toHaveBeenCalled();
    expect(result.modelCalls).toBe(1);
    expect(result.beat.subheadline).toBe("₦2,500 a bottle");
  });

  it("judges a planned fact against the planned list, not a fresh read", async () => {
    generateObject.mockResolvedValue(
      rewrite({ headline: "Worth every naira", subheadline: "" }),
    );
    const planned = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader, facts: [], offering: "cold brew" },
    );
    expect(planned.beat.headline).toBe("Worth every naira");
    const reread = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    ).catch((e: unknown) => e);
    expect(reread).toBeInstanceOf(FrameReplanError);
  });

  it("reads a venue the brief calls ours as the brand's name and area, as the directions do", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 4,
        headline: "Find Kiln Coffee, Yaba",
        subheadline: "Cold glasses at the counter",
      }),
    );
    const result = await replanFrame(
      { context, plan, index: 3 },
      { briefReader: reader },
    );
    expect(result.beat.headline).toBe("Find Kiln Coffee, Yaba");
  });

  it("refuses a rewrite that drops a fact only this frame stated", async () => {
    generateObject.mockResolvedValue(
      rewrite({ headline: "Worth every naira", subheadline: "" }),
    );
    const err = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    ).catch((e: unknown) => e);
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
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FrameReplanError);
  });

  it("refuses a number the brief never gave", async () => {
    generateObject.mockResolvedValue(
      rewrite({ subheadline: "₦2,500 a bottle · 40 bottles made" }),
    );
    const err = await replanFrame(
      { context, plan, index: 1 },
      { briefReader: reader },
    ).catch((e: unknown) => e);
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

describe("replanFrame without edits: the round-2 critic's probes", () => {
  const plan = cafePlan();
  const held = {
    briefReader: reader,
    facts: [
      fact("price", "₦2,500 a bottle"),
      fact("date", "Saturday 15 November"),
      fact("time", "8am to 2pm"),
      fact("contact", "WhatsApp 0803 555 0142"),
    ],
    offering: "cold brew",
  };

  it("P1: a rewrite of the action frame with an empty button keeps the set's button", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 5,
        title: "Reserve yours",
        headline: "Your Saturday ritual starts here",
        subheadline: "",
        footerLines: ["WhatsApp 0803 555 0142"],
        cta: "",
      }),
    );
    const { beat } = await replanFrame({ context, plan, index: 4 }, held);
    expect(beat.role).toBe("cta");
    expect(beat.cta).toBe(plan.frames[4].cta);
    const frames = plan.frames.map((f, i) => (i === 4 ? beat : f));
    expect(
      validateSequence(
        { ...plan, frames },
        { ...CAFE_RULES, facts: held.facts },
      ).map((p) => p.rule),
    ).not.toContain("cta-last");
  });

  it("P1: regenerateProblems names an action frame left without its button", () => {
    const next = { ...plan.frames[4], cta: "" };
    expect(
      regenerateProblems(plan, 4, next, {
        facts: held.facts,
        offering: "cold brew",
        invented: [],
        brandName: "Kiln Coffee",
      }),
    ).toContain("the last frame has no button");
  });

  it("P2: refuses a hook that announces the offering", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 1,
        title: "The launch",
        headline: "Cold brew is here",
        subheadline: "At Kiln Coffee",
      }),
    );
    const err = await replanFrame({ context, plan, index: 0 }, held).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FrameReplanError);
    expect((err as FrameReplanError).problems).toContainEqual(
      expect.stringContaining("announces the offering"),
    );
  });

  it("P2: keeps a hook that gives a reason to swipe", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 1,
        title: "The launch",
        headline: "Why rush a Saturday?",
        subheadline: "Kiln's cold brew, poured over ice",
      }),
    );
    const { beat } = await replanFrame({ context, plan, index: 0 }, held);
    expect(beat.headline).toBe("Why rush a Saturday?");
  });

  it("says why a regenerate was refused, in words the user can read", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        headline: "Your Saturday ritual starts with one message",
        subheadline: "₦2,500 a bottle",
      }),
    );
    const err = await replanFrame({ context, plan, index: 1 }, held).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(FrameReplanError);
    expect((err as FrameReplanError).message).toContain(
      'the new version states "one", which the brief does not give',
    );
    expect((err as FrameReplanError).message).toContain(
      "The frame is unchanged",
    );
  });

  it("tells the model a number written as a word is a number", async () => {
    generateObject.mockResolvedValue(rewrite());
    await replanFrame({ context, plan, index: 1 }, held);
    const prompt = generateObject.mock.calls[0][0].prompt as string;
    expect(prompt).toContain(
      'a number written as a word counts ("one message"',
    );
  });
});

describe("replanReason", () => {
  it("reads the first problem as the user would", () => {
    expect(
      replanReason(['it states "one", which the brief does not give']),
    ).toBe('the new version states "one", which the brief does not give');
    expect(replanReason([])).toBeNull();
  });
});
