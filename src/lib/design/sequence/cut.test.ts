import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { cutsOf, withFaultsCut } from "./cut";
import {
  beatOf,
  CAFE_BRIEF,
  CAFE_FACTS,
  CAFE_RULES,
  cafePlan,
  withFrame,
} from "./fixtures";
import { cutHolds, hardScore, planScore } from "./plan";

const ledger = factLedger([CAFE_BRIEF, "Kiln Coffee"], 2);
const names = ["cold brew"];
const score = (plan: ReturnType<typeof cafePlan>) =>
  planScore(plan, { rules: CAFE_RULES, ledger, names });
const hard = (plan: ReturnType<typeof cafePlan>) =>
  hardScore(plan, { rules: CAFE_RULES, ledger, names });
const holds = (
  before: ReturnType<typeof cafePlan>,
  after: ReturnType<typeof cafePlan>,
) => cutHolds(before, after, hard, CAFE_FACTS);
/* The fixture with its price beside the action, so a test adds one
   fault and the cut has that one to take out. */
const clean = () =>
  withFrame(
    withFrame(cafePlan(), 1, {
      headline: "Chilled and ready to carry",
      subheadline: "",
    }),
    4,
    { footerLines: ["₦2,500 a bottle", "WhatsApp 0803 555 0142"] },
  );

describe("cutsOf", () => {
  it("offers each subheadline sentence, the whole subheadline only when allowed, and each footer line, never the headline or button", () => {
    const beat = beatOf({
      role: "cta",
      headline: "Reserve yours",
      subheadline: "One a person. Pay when you collect.",
      cta: "Message us",
      footerLines: ["WhatsApp 0803 555 0142"],
    });
    expect(cutsOf(beat).map((c) => c.removed)).toEqual([
      "One a person.",
      "Pay when you collect.",
      "WhatsApp 0803 555 0142",
    ]);
    const removed = cutsOf(beat, true).map((c) => c.removed);
    expect(removed).toEqual([
      "One a person.",
      "Pay when you collect.",
      "One a person. Pay when you collect.",
      "WhatsApp 0803 555 0142",
    ]);
    for (const option of cutsOf(beat, true)) {
      expect(option.beat.headline).toBe("Reserve yours");
      expect(option.beat.cta).toBe("Message us");
    }
  });
});

describe("withFaultsCut", () => {
  it("leaves a subheadline of one sentence unless it carries an invented term", () => {
    const shared = withFrame(clean(), 0, {
      headline: "Cold brew, steeped slow",
      subheadline: "Sit in with a glass, or carry yours out",
    });
    expect(withFaultsCut(shared, score, holds).cuts).toEqual([]);
    const invented = withFrame(clean(), 3, {
      subheadline: "No hidden charges at the bar",
    });
    const { plan: cut } = withFaultsCut(invented, score, holds, (beat) =>
      beat.subheadline.includes("hidden"),
    );
    expect(cut.frames[3].subheadline).toBe("");
  });

  it("cuts the sentence carrying an invented commercial term and keeps the rest", () => {
    const plan = withFrame(clean(), 3, {
      subheadline: "Sit in with a glass. No hidden charges.",
    });
    const { plan: cut, cuts } = withFaultsCut(plan, score, holds);
    expect(cuts).toEqual([{ frame: 3, removed: "No hidden charges." }]);
    expect(cut.frames[3].subheadline).toBe("Sit in with a glass.");
    expect(score(cut)).toBeLessThan(score(plan));
  });

  it("cuts the sentence that spends a later frame's point on the hook (round-5 critic, HIGH 4)", () => {
    const plan = withFrame(clean(), 0, {
      headline: "Cold brew, steeped slow",
      subheadline:
        "Steeped overnight. Sit in with a glass, or carry yours out.",
    });
    const { plan: cut, cuts } = withFaultsCut(plan, score, holds);
    expect(cuts).toEqual([
      { frame: 0, removed: "Sit in with a glass, or carry yours out." },
    ]);
    expect(cut.frames[0].subheadline).toBe("Steeped overnight.");
    expect(score(cut)).toBeLessThan(score(plan));
  });

  it("never cuts a fact the set would lose, or the action frame's how", () => {
    const plan = withFrame(clean(), 2, {
      subheadline: "8am to 2pm",
      footerLines: [],
    });
    const { plan: cut } = withFaultsCut(plan, score, holds);
    expect(cut.frames[2].subheadline).toBe("8am to 2pm");
    expect(cut.frames[4].footerLines).toContain("WhatsApp 0803 555 0142");
  });

  it("leaves words the planner marks uncuttable, however much they repeat (round-6 coverage misses)", () => {
    const plan = withFrame(clean(), 3, {
      subheadline: "Sit in with a glass. 8am to 2pm.",
    });
    const all = withFaultsCut(plan, score, holds);
    expect(all.cuts.map((c) => c.removed)).toContain("8am to 2pm.");
    const kept = withFaultsCut(
      plan,
      score,
      holds,
      () => false,
      (removed) => !/\d/.test(removed),
    );
    expect(kept.cuts.map((c) => c.removed)).not.toContain("8am to 2pm.");
    expect(kept.plan.frames[3].subheadline).toContain("8am to 2pm.");
  });

  it("changes nothing on a plan with nothing to cut", () => {
    const plan = clean();
    expect(withFaultsCut(plan, score, holds)).toEqual({ plan, cuts: [] });
  });
});
