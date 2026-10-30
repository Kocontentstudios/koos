import { describe, expect, it } from "vitest";
import { factLedger } from "@/lib/jobs/directions/claims";
import { CAFE_BRIEF, CAFE_RULES, cafePlan, withFrame } from "./fixtures";
import { hookScore, planScore } from "./plan";

const ledger = factLedger([CAFE_BRIEF, "Kiln Coffee"], 2);
/* The fixture with its price frame given a line, so nothing is left. */
const clean = () =>
  withFrame(cafePlan(), 1, { subheadline: "Kept cold, ready at the counter" });
const score = (plan = clean(), names: string[] = []) =>
  planScore(plan, { rules: CAFE_RULES, ledger, names });

describe("planScore", () => {
  it("is 0 for a plan with nothing left to fix", () => {
    expect(score()).toBe(0);
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
    const uncovered = score(withFrame(clean(), 2, { subheadline: "" }));
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
      "Our cold brew, kept cold at the counter",
    );
    const clear = withHook(
      "Why rush a Saturday?",
      "Our cold brew, slow and strong",
    );
    expect(opening(clear)).toBe(0);
    /* "kept cold at the counter" is frame 2's point: the editor weighs it. */
    expect(opening(pull)).toBe(0);
    expect(opening(label)).toBeGreaterThan(0);
    /* planScore still counts the shared phrase, so the drafts and the edit
       pass are asked to fix it; the hook choice leaves it to the editor. */
    expect(score(pull)).toBeGreaterThan(0);
  });
});
