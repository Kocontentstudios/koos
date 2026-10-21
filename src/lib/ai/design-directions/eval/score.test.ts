import { describe, expect, it } from "vitest";
import { finalizeDirection } from "@/lib/jobs/directions/finalize";
import { contrastingDraft, draftOf } from "@/lib/jobs/directions/fixtures";
import { DIRECTIONS_EVAL_CASES, DIRECTIONS_EVAL_THRESHOLDS } from "./cases";
import {
  aggregateDirections,
  directionsPassed,
  factsFor,
  scoreDirectionsCase,
} from "./score";

const bakery = DIRECTIONS_EVAL_CASES[0];
const finalize = (d: ReturnType<typeof draftOf>) =>
  finalizeDirection(d, {
    aspectRatio: "4:5",
    facts: factsFor(bakery),
    fallbackReasons: [],
    fallbackTitle: d.title,
  });

function scored(drafts: ReturnType<typeof draftOf>[], redrafted = false) {
  return scoreDirectionsCase(bakery, {
    drafts,
    directions: drafts.map(finalize),
    redrafted,
    modelCalls: redrafted ? 2 : 1,
  });
}

describe("the directions eval", () => {
  it("covers at least six cases across both image sources", () => {
    expect(DIRECTIONS_EVAL_CASES.length).toBeGreaterThanOrEqual(6);
    const sources = new Set(DIRECTIONS_EVAL_CASES.map((c) => c.imageSource));
    expect(sources).toEqual(new Set(["upload", "ko"]));
    expect(
      new Set(DIRECTIONS_EVAL_CASES.map((c) => c.category)).size,
    ).toBeGreaterThanOrEqual(6);
  });

  it("scores a distinct, grounded pair as a pass", () => {
    const score = scored([
      draftOf({
        rationale: [
          "Leads with the mille-feuille itself, the new slice",
          "Pickup from 7am speaks to commuters",
        ],
      }),
      contrastingDraft({
        rationale: [
          "Monday launch date is the headline's promise",
          "Price of ₦4,500 sits beside the order button",
        ],
      }),
    ]);
    expect(score.layoutsDiffer).toBe(true);
    expect(score.finalNearDuplicate).toBe(false);
    expect(score.grounded).toBe(4);
    expect(score.filler).toBe(0);
    const totals = aggregateDirections([score]);
    expect(directionsPassed(totals, DIRECTIONS_EVAL_THRESHOLDS, 1)).toBe(true);
  });

  it("fails a pair that is one idea written twice", () => {
    const score = scored([
      draftOf(),
      draftOf({ layout: "split-left", title: "Morning bake" }),
    ]);
    expect(score.finalNearDuplicate).toBe(true);
    expect(
      directionsPassed(
        aggregateDirections([score]),
        DIRECTIONS_EVAL_THRESHOLDS,
        1,
      ),
    ).toBe(false);
  });

  it("counts praise that names nothing from the brief as filler", () => {
    const score = scored([
      draftOf({
        rationale: ["Eye-catching and modern", "Stands out in the feed"],
      }),
      contrastingDraft(),
    ]);
    expect(score.filler).toBe(2);
  });

  it("separates the model's own compliance from the delivered contract", () => {
    const score = scored([
      draftOf({
        title: "A very long concept title that keeps on going for ever",
      }),
      contrastingDraft(),
    ]);
    expect(score.modelWithinLimits).toBe(false);
    expect(score.withinLimits).toBe(true);
  });

  it("fails a run that lost a case to an error", () => {
    const totals = aggregateDirections([
      scored([draftOf(), contrastingDraft()]),
    ]);
    expect(directionsPassed(totals, DIRECTIONS_EVAL_THRESHOLDS, 7)).toBe(false);
  });
});
