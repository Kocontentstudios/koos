import { describe, expect, it } from "vitest";
import type { SequenceRule } from "./contract";
import { CAFE_RULES, cafePlan, fact, withFrame } from "./fixtures";
import {
  copyLimitProblems,
  factsUncovered,
  type SequenceRules,
  validateSequence,
} from "./validate";

const rulesOf = (
  plan = cafePlan(),
  rules: SequenceRules = CAFE_RULES,
): SequenceRule[] => validateSequence(plan, rules).map((p) => p.rule);

describe("validateSequence", () => {
  it("passes a plan that keeps every rule", () => {
    expect(validateSequence(cafePlan(), CAFE_RULES)).toEqual([]);
  });

  describe("count", () => {
    it("names a set with more or fewer frames than asked", () => {
      const problems = validateSequence(cafePlan(), {
        ...CAFE_RULES,
        frameCount: 6,
      });
      expect(problems).toContainEqual({
        frame: null,
        rule: "count",
        detail: "5 frames where 6 were asked for",
      });
    });
  });

  describe("hook-first", () => {
    it("names a first frame that is not the hook", () => {
      expect(rulesOf(withFrame(cafePlan(), 0, { role: "body" }))).toContain(
        "hook-first",
      );
    });

    it("names a hook anywhere but first", () => {
      const problems = validateSequence(
        withFrame(cafePlan(), 2, { role: "hook" }),
        CAFE_RULES,
      );
      expect(problems).toContainEqual(
        expect.objectContaining({ frame: 2, rule: "hook-first" }),
      );
    });
  });

  describe("cta-last", () => {
    it("names a last frame that is not the call to action", () => {
      expect(
        rulesOf(withFrame(cafePlan(), 4, { role: "body", cta: "" })),
      ).toContain("cta-last");
    });

    it("names a call-to-action frame with no button", () => {
      const problems = validateSequence(
        withFrame(cafePlan(), 4, { cta: "  " }),
        CAFE_RULES,
      );
      expect(problems).toContainEqual({
        frame: 4,
        rule: "cta-last",
        detail: "the last frame has no button",
      });
    });
  });

  describe("cta-only-last", () => {
    it("names a button on any frame but the last", () => {
      const problems = validateSequence(
        withFrame(cafePlan(), 1, { cta: "Buy now" }),
        CAFE_RULES,
      );
      expect(problems).toContainEqual(
        expect.objectContaining({ frame: 1, rule: "cta-only-last" }),
      );
    });

    it("names a call-to-action frame before the last", () => {
      expect(rulesOf(withFrame(cafePlan(), 2, { role: "cta" }))).toContain(
        "cta-only-last",
      );
    });
  });

  describe("layout-repeat", () => {
    it("names a frame drawn in its neighbour's layout", () => {
      const problems = validateSequence(
        withFrame(cafePlan(), 2, { layout: "stat-highlight" }),
        CAFE_RULES,
      );
      expect(problems).toContainEqual(
        expect.objectContaining({ frame: 2, rule: "layout-repeat" }),
      );
    });

    it("names two neighbours drawn as the same centred card", () => {
      const plan = withFrame(cafePlan(), 2, { layout: "quote-card" });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({ frame: 2, rule: "layout-repeat" }),
      );
    });

    it("lets a layout return once another sits between", () => {
      const plan = withFrame(cafePlan(), 2, { layout: "banner-bottom" });
      expect(rulesOf(plan)).not.toContain("layout-repeat");
    });
  });

  describe("headline-repeat", () => {
    it("names a headline saying what an earlier frame said", () => {
      const plan = withFrame(cafePlan(), 3, {
        headline: "Your Saturday, slowed right down",
      });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({ frame: 3, rule: "headline-repeat" }),
      );
    });

    it("compares frames that are not neighbours", () => {
      const plan = withFrame(cafePlan(), 4, {
        headline: "₦2,500 a bottle",
      });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({ frame: 4, rule: "headline-repeat" }),
      );
    });

    it("lets every frame share the brand's name", () => {
      const plan = withFrame(
        withFrame(cafePlan(), 1, { headline: "Kiln Coffee pours slow" }),
        3,
        { headline: "Kiln Coffee in Yaba" },
      );
      expect(rulesOf(plan)).not.toContain("headline-repeat");
    });
  });

  describe("copy-length", () => {
    it("names a headline past the 70 characters a frame draws", () => {
      const plan = withFrame(cafePlan(), 1, {
        headline: "x".repeat(71),
      });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({
          frame: 1,
          rule: "copy-length",
          detail: "the headline is 71 characters, over the 70 a frame draws",
        }),
      );
    });

    it("names a headline past the format's word budget", () => {
      const plan = withFrame(cafePlan(), 1, {
        headline: "One two three four five six seven eight",
      });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({
          frame: 1,
          detail:
            "the headline is 8 words, over the 7 a carousel frame is read in",
        }),
      );
    });

    it("gives a presentation slide the deck's longer budget", () => {
      const plan = withFrame(cafePlan({ kind: "presentation" }), 1, {
        headline: "One two three four five six seven eight",
      });
      expect(rulesOf(plan)).not.toContain("copy-length");
    });

    it("names every field past its limit and too many footer lines", () => {
      const beat = {
        ...cafePlan().frames[4],
        title: "t".repeat(41),
        subheadline: "s".repeat(141),
        cta: "c".repeat(33),
        footerLines: ["a", "b", "c", "f".repeat(61)],
      };
      const details = copyLimitProblems(beat, 4, "carousel").map(
        (p) => p.detail,
      );
      expect(details).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^the title is 41/),
          expect.stringMatching(/^the subheadline is 141/),
          expect.stringMatching(/^the button is 33/),
          expect.stringMatching(/^the footer line is 61/),
          "4 footer lines, over the 3 the footer draws",
        ]),
      );
    });

    it("names an empty headline", () => {
      expect(
        copyLimitProblems(
          { ...cafePlan().frames[1], headline: " " },
          1,
          "carousel",
        ),
      ).toContainEqual(
        expect.objectContaining({ detail: "the headline is empty" }),
      );
    });

    it("leaves the word budget off when asked to", () => {
      const beat = {
        ...cafePlan().frames[1],
        headline: "One two three four five six seven eight",
      };
      expect(copyLimitProblems(beat, 1, "carousel", { budget: false })).toEqual(
        [],
      );
    });
  });

  describe("fact-uncovered", () => {
    it("is set-level: each fact on one frame is enough", () => {
      expect(factsUncovered(cafePlan().frames, CAFE_RULES.facts)).toEqual([]);
    });

    it("names a fact no frame states", () => {
      const plan = withFrame(cafePlan(), 4, { footerLines: [] });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual({
        frame: null,
        rule: "fact-uncovered",
        detail: 'no frame states "WhatsApp 0803 555 0142"',
      });
    });

    it("does not count a price without its unit", () => {
      const plan = withFrame(cafePlan(), 1, { headline: "Just ₦2,500" });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual(
        expect.objectContaining({
          rule: "fact-uncovered",
          detail: 'no frame states "₦2,500 a bottle"',
        }),
      );
    });

    it("counts a fact stated in other words the fact forms accept", () => {
      const rules = {
        ...CAFE_RULES,
        facts: [fact("contact", "WhatsApp 0803 555 0142")],
      };
      const plan = withFrame(cafePlan(), 4, {
        footerLines: ["WhatsApp 08035550142"],
      });
      expect(rulesOf(plan, rules)).not.toContain("fact-uncovered");
    });
  });

  describe("offering-unnamed", () => {
    it("names a hook that does not say what is on offer", () => {
      const plan = withFrame(cafePlan(), 0, {
        headline: "Something new in Yaba",
        subheadline: "",
      });
      expect(validateSequence(plan, CAFE_RULES)).toContainEqual({
        frame: 0,
        rule: "offering-unnamed",
        detail: 'the hook does not name "cold brew"',
      });
    });

    it("only asks it of the hook", () => {
      const plan = withFrame(cafePlan(), 0, {
        headline: "Something new in Yaba",
        subheadline: "Slow-steeped cold brew",
      });
      expect(rulesOf(plan)).not.toContain("offering-unnamed");
    });

    it("is not asked when the brief names nothing on offer", () => {
      const plan = withFrame(cafePlan(), 0, { headline: "Hello Yaba" });
      expect(rulesOf(plan, { ...CAFE_RULES, offering: null })).not.toContain(
        "offering-unnamed",
      );
    });
  });

  describe("hook-without-image", () => {
    it("names a hook drawn without the set's image", () => {
      const plan = withFrame(cafePlan(), 0, { showsImage: false });
      expect(rulesOf(plan)).toContain("hook-without-image");
    });

    it("is not asked of a set with no image", () => {
      const plan = withFrame(cafePlan(), 0, { showsImage: false });
      expect(rulesOf(plan, { ...CAFE_RULES, hasImage: false })).not.toContain(
        "hook-without-image",
      );
    });
  });

  it("returns every problem, not the first", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 0, { role: "body", showsImage: false }),
      1,
      { cta: "Buy" },
    );
    expect(new Set(rulesOf(plan))).toEqual(
      new Set(["hook-first", "cta-only-last", "hook-without-image"]),
    );
  });
});
