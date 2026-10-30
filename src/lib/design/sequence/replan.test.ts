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
    const { beat } = applyFrameEdits(plan, 4, { headline: "See you there" });
    const { headline: _, ...kept } = beat;
    const { headline: __, ...before } = plan.frames[4];
    expect(kept).toEqual(before);
  });

  it("keeps a field the user left out, and clears one they emptied", () => {
    const { beat } = applyFrameEdits(plan, 0, { subheadline: "" });
    expect(beat.headline).toBe(plan.frames[0].headline);
    expect(beat.subheadline).toBe("");
  });

  it("only trims whitespace no one would see", () => {
    expect(
      applyFrameEdits(plan, 1, { headline: "  Hi there  " }).beat.headline,
    ).toBe("Hi there");
  });

  it("refuses words past a frame's limit with a reason the user can act on", () => {
    const tooLong = "x".repeat(75);
    expect(() => applyFrameEdits(plan, 1, { headline: tooLong })).toThrow(
      new FrameEditError(
        "The headline is 75 characters; a frame fits 70. Shorten it by 5.",
        "headline",
      ),
    );
    try {
      applyFrameEdits(plan, 4, { cta: "c".repeat(40) });
    } catch (err) {
      expect(err).toBeInstanceOf(FrameEditError);
      expect((err as FrameEditError).field).toBe("cta");
      expect((err as Error).message).toContain("button text is 40 characters");
    }
  });

  it("accepts words at exactly the limit", () => {
    const atLimit = "x".repeat(70);
    expect(applyFrameEdits(plan, 1, { headline: atLimit }).beat.headline).toBe(
      atLimit,
    );
  });

  it("refuses an empty headline", () => {
    expect(() => applyFrameEdits(plan, 1, { headline: "   " })).toThrow(
      "Every frame needs a headline.",
    );
  });

  it("refuses a button anywhere but the last frame, and the last without one", () => {
    expect(() => applyFrameEdits(plan, 2, { cta: "Buy" })).toThrow(
      FrameEditError,
    );
    expect(() => applyFrameEdits(plan, 4, { cta: "" })).toThrow(
      "The last frame needs its button text",
    );
    expect(applyFrameEdits(plan, 4, { cta: "Book now" }).beat.cta).toBe(
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
    /* The figure moved to the subheadline, so the stat layout has nothing
       to set large and becomes the statement card. */
    expect(result.beat).toEqual({
      ...plan.frames[1],
      headline: "Slow coffee, fair price",
      subheadline: "₦2,500 a bottle",
      layout: "quote-card",
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

describe("replanFrame without edits: probes", () => {
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

  it("a rewrite of the action frame with an empty button keeps the set's button", async () => {
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

  it("regenerateProblems names an action frame left without its button", () => {
    const next = { ...plan.frames[4], cta: "" };
    expect(
      regenerateProblems(plan, 4, next, {
        facts: held.facts,
        offering: "cold brew",
        invented: [],
        brandName: "Kiln Coffee",
      }),
    ).toContainEqual({ kind: "role", detail: "the last frame has no button" });
  });

  it("refuses a hook that announces the offering", async () => {
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

  it("keeps a hook that gives a reason to swipe", async () => {
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
    expect((err as FrameReplanError).message).toBe(
      "KO couldn't rewrite this frame to fit the set. The new version added a detail neither the brief nor the brand profile gives. The frame is unchanged. Try again, or edit its words.",
    );
    expect((err as FrameReplanError).reasons).toContain("invented");
    expect((err as FrameReplanError).problems).toContain(
      'it states "one", which the brief does not give',
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
  const flat = {
    kind: "flat-hook" as const,
    detail:
      'the hook\'s headline "Cold brew is here" announces the offering, which gives no reason to swipe; make the headline the reason to swipe',
  };
  const long = {
    kind: "too-long" as const,
    detail: "the headline is 90 characters",
  };

  it("gives the user a short sentence keyed by the problem, never the model's instruction", () => {
    expect(replanReason([[flat], [flat]])).toBe(
      "Every new version was a label, not a reason to swipe.",
    );
    expect(replanReason([])).toBeNull();
  });

  it("says a problem of every version only when every version has it", () => {
    expect(replanReason([[long], [flat]])).toBe(
      "One new version was too long to fit; another was a label, not a reason to swipe.",
    );
    expect(replanReason([[flat, long], [long]])).toBe(
      "Every new version was too long to fit.",
    );
  });

  it("speaks of the one version when only one came back", () => {
    expect(replanReason([[long]])).toBe("The new version was too long to fit.");
    expect(
      replanReason([[{ kind: "nothing-back", detail: "no frame came back" }]]),
    ).toBe("No new version came back.");
  });

  it("the refused hook's message says nothing addressed to a model", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 1,
        title: "The launch",
        headline: "Cold brew is here",
        subheadline: "At Kiln Coffee",
      }),
    );
    const err = (await replanFrame(
      { context, plan: cafePlan(), index: 0 },
      {
        briefReader: reader,
        facts: [fact("price", "₦2,500 a bottle")],
        offering: "cold brew",
      },
    ).catch((e: unknown) => e)) as FrameReplanError;
    expect(err).toBeInstanceOf(FrameReplanError);
    expect(err.message).toBe(
      "KO couldn't rewrite this frame to fit the set. The new version was a label, not a reason to swipe. The frame is unchanged. Try again, or edit its words.",
    );
    expect(err.message).not.toMatch(/subheadline|swipe;|headline "/);
    expect(err.message.length).toBeLessThan(160);
  });
});

describe("applyFrameEdits: a headline another frame has", () => {
  it("refuses an edit that repeats another frame's headline word for word, ignoring case", () => {
    const plan = cafePlan();
    const err = (() => {
      try {
        applyFrameEdits(plan, 2, {
          headline: "  your saturday,  SLOWED down ",
        });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(err).toBeInstanceOf(FrameEditError);
    expect((err as FrameEditError).field).toBe("headline");
    expect((err as FrameEditError).message).toBe(
      "Frame 1 already has this headline. Give this frame its own.",
    );
  });

  it.each([
    "Your Saturday, slowed down!?",
    "your saturday slowed down",
    "Your Saturday — slowed down.",
  ])("refuses %j, the same words in other punctuation", (headline) => {
    expect(() => applyFrameEdits(cafePlan(), 2, { headline })).toThrow(
      "Frame 1 already has this headline.",
    );
  });

  it("lets a frame keep its own headline while another field is edited", () => {
    const plan = cafePlan();
    expect(
      applyFrameEdits(plan, 0, { headline: plan.frames[0].headline }).beat
        .headline,
    ).toBe(plan.frames[0].headline);
    expect(
      applyFrameEdits(plan, 2, { subheadline: "From 8am" }).beat.subheadline,
    ).toBe("From 8am");
  });
});

describe("applyFrameEdits: what an edit uncovers", () => {
  const facts = [
    fact("price", "₦2,500 a bottle"),
    fact("contact", "WhatsApp 0803 555 0142"),
  ];

  it("clearing the only frame that gave the price keeps the user's words and names the price", () => {
    const plan = cafePlan();
    const { beat, uncovered } = applyFrameEdits(
      plan,
      1,
      { headline: "Slow coffee, worth the wait" },
      facts,
    );
    expect(beat.headline).toBe("Slow coffee, worth the wait");
    expect(uncovered.map((f) => f.text)).toEqual(["₦2,500 a bottle"]);
  });

  it("names nothing when coverage holds, or when the fact was already missing", () => {
    const plan = cafePlan();
    expect(
      applyFrameEdits(plan, 2, { subheadline: "" }, facts).uncovered,
    ).toEqual([]);
    const without = applyFrameEdits(
      plan,
      1,
      { headline: "Slow coffee" },
      facts,
    );
    const after = {
      ...plan,
      frames: plan.frames.map((b, i) => (i === 1 ? without.beat : b)),
    };
    expect(
      applyFrameEdits(after, 1, { headline: "Slower coffee" }, facts).uncovered,
    ).toEqual([]);
  });

  it("returns the uncovered facts through replanFrame, with no model call", async () => {
    const result = await replanFrame(
      {
        context,
        plan: cafePlan(),
        index: 1,
        edits: { headline: "Slow coffee" },
      },
      { briefReader: reader, facts, offering: "cold brew" },
    );
    expect(result.modelCalls).toBe(0);
    expect(result.uncovered.map((f) => f.text)).toEqual(["₦2,500 a bottle"]);
    expect(reader).not.toHaveBeenCalled();
  });

  it("sets a stat-highlight the edit left with no figure as the statement card", () => {
    const plan = cafePlan();
    const stat = {
      ...plan,
      frames: plan.frames.map((b, i) =>
        i === 2 ? { ...b, layout: "stat-highlight" as const } : b,
      ),
    };
    expect(
      applyFrameEdits(stat, 2, { headline: "Patience in every glass" }).beat
        .layout,
    ).toBe("quote-card");
    expect(
      applyFrameEdits(stat, 2, { headline: "18 hours, no shortcuts" }).beat
        .layout,
    ).toBe("stat-highlight");
  });
});

describe("replanFrame: one fact twice on one frame", () => {
  const facts = [
    fact("price", "₦2,500 a bottle"),
    fact("contact", "WhatsApp 0803 555 0142"),
  ];

  it("drops the footer line that repeats the copy above, so the regenerate stands", async () => {
    generateObject.mockResolvedValue(
      rewrite({
        frame: 5,
        title: "Reserve yours",
        headline: "Your bottle, held for you",
        subheadline: "₦2,500 a bottle, on WhatsApp 0803 555 0142.",
        footerLines: ["₦2,500 a bottle", "WhatsApp 0803 555 0142"],
        cta: "Message us",
      }),
    );
    const plan = cafePlan();
    const result = await replanFrame(
      { context, plan, index: 4 },
      { briefReader: reader, facts, offering: "cold brew" },
    );
    expect(result.beat.subheadline).toBe(
      "₦2,500 a bottle, on WhatsApp 0803 555 0142.",
    );
    expect(result.beat.footerLines).toEqual([]);
  });

  it("names a fact said twice on the frame as its own problem", () => {
    const plan = cafePlan();
    const next = {
      ...plan.frames[4],
      subheadline: "₦2,500 a bottle",
      headline: "₦2,500 a bottle, held for you",
    };
    const problems = regenerateProblems(plan, 4, next, {
      facts,
      offering: "cold brew",
      invented: [],
      brandName: "Kiln Coffee",
    });
    expect(problems.map((p) => p.kind)).toContain("fact-twice");
    const twice = problems.filter((p) => p.kind === "fact-twice");
    expect(replanReason([twice, twice])).toBe(
      "Every new version gave the same detail twice.",
    );
  });

  it("cleans a planner label off the title a regenerate keeps", async () => {
    generateObject.mockResolvedValue(rewrite());
    const plan = cafePlan();
    const labelled = {
      ...plan,
      frames: plan.frames.map((b, i) =>
        i === 1 ? { ...b, title: "The price — Version A" } : b,
      ),
    };
    const result = await replanFrame(
      { context, plan: labelled, index: 1 },
      { briefReader: reader },
    );
    expect(result.beat.title).toBe("The price");
  });
});
