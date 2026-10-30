import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { CAFE_BRIEF, CAFE_RULES, cafePlan, withFrame } from "./fixtures";
import { hookScore, planScore, repairFixes } from "./plan";

const ledger = factLedger([CAFE_BRIEF, "Kiln Coffee"], 2);
/* The fixture with its price moved beside the action, as a carousel's
   price belongs, so nothing is left. */
const clean = () =>
  withFrame(
    withFrame(cafePlan(), 1, {
      headline: "Chilled and ready to carry",
      subheadline: "",
    }),
    4,
    { footerLines: ["₦2,500 a bottle", "WhatsApp 0803 555 0142"] },
  );
const score = (plan = clean(), names: string[] = []) =>
  planScore(plan, { rules: CAFE_RULES, ledger, names });

describe("planScore", () => {
  it("is 0 for a plan with nothing left to fix", () => {
    expect(score()).toBe(0);
  });

  it("counts a carousel price the copy put on a middle frame (round-3 critic, finding 3)", () => {
    const misplaced = withFrame(cafePlan(), 1, {
      subheadline: "Kept cold, ready at the counter",
    });
    expect(score(misplaced)).toBeGreaterThan(0);
    expect(score({ ...misplaced, kind: "presentation" })).toBe(0);
  });

  it("never trades a brief fact for the removal of an invented one (round-3 partner deck)", () => {
    const invented = withFrame(clean(), 2, {
      subheadline: "8am to 2pm, 40 bottles",
    });
    const uncovered = withFrame(clean(), 2, { subheadline: "" });
    expect(score(invented)).toBeGreaterThan(0);
    expect(score(uncovered)).toBeGreaterThan(score(invented));
  });

  it("weighs a name the hook must carry and drops as much as a fact the set drops", () => {
    const unnamed = score(clean(), ["cold brew", "Kiln Coffee"]);
    /* A subheadline that drops the hours, so the frame is not also a bare
       date (factOnlyFrames). */
    const uncovered = score(
      withFrame(clean(), 2, { subheadline: "Come as early as you like" }),
    );
    expect(unnamed).toBe(uncovered);
  });
});

describe("hookScore", () => {
  const withHook = (headline: string, subheadline: string) =>
    withFrame(clean(), 0, { headline, subheadline });
  const opening = (plan: ReturnType<typeof clean>) =>
    hookScore(plan, { rules: CAFE_RULES, ledger, names: ["cold brew"] });

  it("charges a label or an announcement, never a point a later frame shares", () => {
    const label = withHook("Cold brew at our Yaba bar", "Steeped slow");
    const pull = withHook(
      "Why rush a Saturday?",
      "Our cold brew, chilled and ready to carry",
    );
    const clear = withHook(
      "Why rush a Saturday?",
      "Our cold brew, slow and strong",
    );
    expect(opening(clear)).toBe(0);
    /* "chilled and ready to carry" is frame 2's point: the editor weighs it. */
    expect(opening(pull)).toBe(0);
    expect(opening(label)).toBeGreaterThan(0);
    /* planScore still counts the shared phrase, so the drafts and the edit
       pass are asked to fix it; the hook choice leaves it to the editor. */
    expect(score(pull)).toBeGreaterThan(0);
  });
});

describe("repairFixes", () => {
  it("asks the later frame as well as the hook when the hook previews its point (round 5)", () => {
    /* "Pour" and "carry" are frame 4's ("Pour one at our Yaba bar", "Sit
       in with a glass, or carry yours out"). */
    const previewing = withFrame(clean(), 0, {
      headline: "Why not carry it out?",
      subheadline: "Our cold brew, poured over ice",
    });
    const fixes = repairFixes(previewing, [], {
      facts: CAFE_RULES.facts,
      factsByFrame: [[0], [], [2, 3], [4], [1, 5]],
      ledger,
      offering: "cold brew",
    });
    expect(fixes.find((f) => f.index === 0)?.problems).toEqual([
      expect.stringContaining("the hook already says what frame 4"),
    ]);
    expect(fixes.find((f) => f.index === 3)?.problems).toEqual([
      expect.stringContaining("it makes the point the hook opens on"),
    ]);
  });
});
