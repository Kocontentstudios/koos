import { describe, expect, it } from "vitest";
import { finalizeDirection } from "@/lib/jobs/directions/finalize";
import { contrastingDraft, draftOf } from "@/lib/jobs/directions/fixtures";
import type { DirectionDraft } from "@/lib/jobs/directions/schema";
import { DIRECTIONS_EVAL_CASES, DIRECTIONS_EVAL_THRESHOLDS } from "./cases";
import {
  aggregateDirections,
  checksFor,
  directionsFailures,
  type PlateResult,
  scoreDirectionsCase,
} from "./score";

const bakery = DIRECTIONS_EVAL_CASES.find((c) => c.id === "bakery-upload");
if (!bakery) throw new Error("bakery-upload case missing");
const regenerate = DIRECTIONS_EVAL_CASES.find(
  (c) => c.id === "textile-launch-regenerate",
);
if (!regenerate) throw new Error("regenerate case missing");

const finalize = (d: DirectionDraft) =>
  finalizeDirection(d, {
    aspectRatio: "4:5",
    checks: checksFor(bakery),
    fallbackTitle: d.title,
  }).direction;

const good = (over: Partial<DirectionDraft> = {}) =>
  draftOf({
    headline: "Strawberry mille-feuille is here",
    subheadline: "₦4,500 a slice from Monday",
    cta: "Order for 7am pickup",
    productName: "strawberry mille-feuille",
    rationale: [
      "The headline names the strawberry mille-feuille",
      "The subheadline gives the ₦4,500 price and Monday",
    ],
    ...over,
  });

const other = (over: Partial<DirectionDraft> = {}) =>
  contrastingDraft({
    headline: "Pickup from 7am, before the commute",
    subheadline: "Order ahead: ₦4,500 a slice",
    cta: "Order ahead",
    productName: "strawberry mille-feuille",
    rationale: [
      "Speaks to commuters who order ahead",
      "The button asks commuters to order ahead",
    ],
    ...over,
  });

function scored(drafts: DirectionDraft[], plates: PlateResult[] = []) {
  return scoreDirectionsCase(
    bakery as NonNullable<typeof bakery>,
    {
      drafts,
      directions: drafts.map(finalize),
      redrafted: false,
      modelCalls: 1,
    },
    plates,
  );
}

const failuresOf = (score: ReturnType<typeof scored>, cases = 1) =>
  directionsFailures(
    aggregateDirections([score]),
    DIRECTIONS_EVAL_THRESHOLDS,
    cases,
  );

describe("the directions eval", () => {
  it("covers both image sources, six categories, a product on KO and a regenerate", () => {
    expect(DIRECTIONS_EVAL_CASES.length).toBeGreaterThanOrEqual(8);
    const sources = new Set(DIRECTIONS_EVAL_CASES.map((c) => c.imageSource));
    expect(sources).toEqual(new Set(["upload", "ko"]));
    expect(
      new Set(DIRECTIONS_EVAL_CASES.map((c) => c.category)).size,
    ).toBeGreaterThanOrEqual(6);
    expect(
      DIRECTIONS_EVAL_CASES.some((c) => c.imageSource === "ko" && c.product),
    ).toBe(true);
    expect(DIRECTIONS_EVAL_CASES.some((c) => c.regenerate)).toBe(true);
  });

  it("passes a distinct, true, grounded pair", () => {
    const score = scored([good(), other()]);
    expect(score.layoutsDiffer).toBe(true);
    expect(score.finalNearDuplicate).toBe(false);
    expect(score.modelGrounded).toBe(4);
    expect(failuresOf(score)).toEqual([]);
  });

  it("fails a pair that is one idea written twice", () => {
    const score = scored([
      good(),
      good({ layout: "split-left", title: "Morning bake" }),
    ]);
    expect(score.finalNearDuplicate).toBe(true);
    expect(failuresOf(score)).toContain("near-duplicates");
  });

  /* Round-1 code critic: the eval scored what finalizeReasons selected with
     the rule it selected by. The model lane scores the raw answer. */
  it("scores the model's own reasons, not what finalising kept", () => {
    const score = scored([
      good({
        rationale: [
          "Warm tones feel inviting and friendly",
          "Product fills two-thirds of the frame",
          "Seven layers, seven minutes from your door",
        ],
      }),
      other(),
    ]);
    expect(score.modelGrounded).toBe(2);
    /* "Warm tones" is a colour claim (round 3), "fills two-thirds" a
       position. */
    expect(score.modelSpatial).toBe(2);
    /* "two-thirds" is a fraction the brief never gave, as well as a
       position. */
    expect(score.modelInvented).toBe(2);
    expect(score.spatial).toBe(0);
    expect(score.invented).toBe(0);
    expect(failuresOf(score)).toEqual(
      expect.arrayContaining([
        "model reasons grounded",
        "model spatial claims",
        "model invented facts",
      ]),
    );
  });

  it("counts invented facts in the model's copy", () => {
    const score = scored([
      good({ headline: "12 Artisans, one slice" }),
      other(),
    ]);
    expect(score.modelInvented).toBe(1);
    expect(score.modelInventedExamples[0]).toMatch(/12/);
    expect(score.invented).toBe(0);
  });

  it("separates the model's own lengths from the delivered contract", () => {
    const score = scored([
      good({ title: "A very long concept title that keeps on going for ever" }),
      other(),
    ]);
    expect(score.modelDirectionsWithinLimits).toBe(1);
    expect(score.withinLimits).toBe(true);
  });

  it("detects a delivered reason cut from the model's sentence", () => {
    const raw =
      "The headline names the strawberry mille-feuille that commuters want";
    const score = scoreDirectionsCase(bakery as NonNullable<typeof bakery>, {
      drafts: [
        good({ rationale: [raw, "Speaks to commuters who order ahead"] }),
        other(),
      ],
      directions: [
        {
          ...finalize(good()),
          rationale: [
            "The headline names the strawberry mille-feuille that",
            "Speaks to commuters who order ahead",
          ],
        },
        finalize(other()),
      ],
      redrafted: false,
      modelCalls: 1,
    });
    expect(score.cutOff).toBe(1);
  });

  it("fails a delivered plate that shows another product", () => {
    const plates: PlateResult[] = [
      {
        check: "passed",
        imageCalls: 1,
        showsProduct: true,
        subject: "mille-feuille",
      },
      {
        check: "unchecked",
        imageCalls: 1,
        showsProduct: false,
        subject: "a tart",
      },
    ];
    const totals = aggregateDirections([scored([good(), other()], plates)]);
    expect(totals.wrongProductPlates).toBe(1);
    expect(totals.plateShowsProduct).toBe(0.5);
    expect(directionsFailures(totals, DIRECTIONS_EVAL_THRESHOLDS, 1)).toContain(
      "wrong-product plates delivered",
    );
  });

  it("scores a regenerate against both existing directions", () => {
    const rc = regenerate as NonNullable<typeof regenerate>;
    const draft = draftOf({
      layout: "banner-bottom",
      title: "Colour story",
      headline: "Rust and indigo for your home",
      subheadline: "The autumn aso-oke collection, from 3 November",
      cta: "See the throws",
      backgroundPrompt: "folded rust and indigo cloth on linen",
      productName: "aso-oke throws",
      rationale: [
        "The headline names the rust and indigo colours",
        "The subheadline gives the 3 November launch",
      ],
    });
    const score = scoreDirectionsCase(rc, {
      drafts: [draft],
      directions: [
        finalizeDirection(draft, {
          aspectRatio: "4:5",
          checks: checksFor(rc),
          fallbackTitle: "x",
        }).direction,
      ],
      redrafted: false,
      modelCalls: 1,
    });
    expect(score.expected).toBe(1);
    expect(score.layoutsDiffer).toBe(true);
    expect(score.finalNearDuplicate).toBe(false);

    const onSibling = scoreDirectionsCase(rc, {
      drafts: [draft],
      directions: [
        {
          ...finalizeDirection(draft, {
            aspectRatio: "4:5",
            checks: checksFor(rc),
            fallbackTitle: "x",
          }).direction,
          layout: "split-left",
        },
      ],
      redrafted: false,
      modelCalls: 1,
    });
    expect(onSibling.layoutsDiffer).toBe(false);
  });

  it("fails a run that lost a case to an error", () => {
    expect(failuresOf(scored([good(), other()]), 9)).toContain("cases 1/9");
  });
});
