import { describe, expect, it } from "vitest";
import type {
  DesignVerdict,
  JudgedCorrection,
  RubricScores,
} from "@/lib/design/quality/judge";
import {
  applyPrescribedChange,
  RUBRIC_CATEGORIES,
} from "@/lib/design/quality/judge";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";
import { DESIGN_JUDGE_EVAL_CASES, DESIGN_JUDGE_EVAL_THRESHOLDS } from "./cases";
import {
  aggregateDesignJudge,
  type DesignJudgeCaseScore,
  designJudgePassed,
  type JudgeCaseFacts,
  scoreDesignJudgeCase,
} from "./score";

/* Gate tests for the paid lane's arithmetic. The lane itself costs a reasoning
   call per case, so the scoring it reports has to be correct without one —
   otherwise a wrong acceptance rate is only discoverable by spending money. */

const SPEC: DesignSpec = designSpecSchema.parse({
  layout: "hero-center",
  headline: "Doors open at seven",
  subheadline: "Highlife and small chops in Yaba",
  cta: "Reserve a seat",
  footerStyle: "text",
  footerLines: ["0800 000 0000"],
  palette: { background: "#102A43", foreground: "#FFFFFF", accent: "#F0B429" },
  logoPlacement: "top-right",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "a warm Lagos rooftop at dusk",
  backgroundTreatment: "photographic",
  nativePrompt: "A rooftop party poster for a Lagos venue",
  aspectRatio: "1:1",
});

const FACTS: JudgeCaseFacts = {
  id: "case",
  renderer: "composite",
  spec: SPEC,
  hasLogo: true,
  expectSawImage: true,
};

const scores = (): RubricScores =>
  Object.fromEntries(
    RUBRIC_CATEGORIES.map((category) => [category, 3]),
  ) as RubricScores;

function verdict(
  change: { field: DesignVerdict["change"]["field"]; value: string },
  over: Partial<DesignVerdict> = {},
): DesignVerdict {
  return {
    scores: scores(),
    weakest: "briefAccuracy",
    seriousFailure: false,
    symptom: "off-brand",
    change,
    reason: "the accent no longer reads as this brand",
    sawImage: true,
    ...over,
  };
}

/** What `judgeAndCorrect` returns for a prescription the guards accepted. */
function accepted(change: {
  field: DesignVerdict["change"]["field"];
  value: string;
}): JudgedCorrection {
  const spec = applyPrescribedChange(SPEC, change, "composite");
  if (!spec)
    throw new Error(`the fixture prescription was refused: ${change.field}`);
  return {
    corrected: true,
    spec,
    verdict: verdict(change),
    applied: {
      field: change.field,
      from: "#F0B429",
      to: change.value,
    },
  };
}

function refused(
  change: { field: DesignVerdict["change"]["field"]; value: string },
  over: Partial<DesignVerdict> = {},
): JudgedCorrection {
  return {
    corrected: false,
    spec: SPEC,
    verdict: verdict(change, over),
    applied: null,
  };
}

describe("scoreDesignJudgeCase", () => {
  it("reports no verdict when the judge was never reached", () => {
    const score = scoreDesignJudgeCase(FACTS, {
      corrected: false,
      spec: SPEC,
      verdict: null,
      applied: null,
    });

    expect(score.verdictReturned).toBe(false);
    expect(score.accepted).toBe(false);
    expect(score.refusedBy).toBeNull();
    expect(score.prescribedField).toBeNull();
  });

  it("counts an accepted prescription and records both sides of it", () => {
    const score = scoreDesignJudgeCase(
      FACTS,
      accepted({ field: "palette.accent", value: "#2563EB" }),
    );

    expect(score.accepted).toBe(true);
    expect(score.refusedBy).toBeNull();
    expect(score.fieldDrawn).toBe(true);
    expect(score.symptomTreatsField).toBe(true);
    expect(score.specChanged).toBe(true);
    expect(score.prescribedValue).toBe("#2563EB");
    expect(score.total).toBe(30);
  });

  /* The hard failure this lane exists to catch. A spec that comes back
     structurally identical but reported as corrected buys a byte-identical
     second render — which is the dice re-roll the judge replaced. Reference
     identity cannot see it: designSpecSchema.parse returns a fresh object. */
  it("flags a correction whose spec is unchanged", () => {
    const score = scoreDesignJudgeCase(FACTS, {
      corrected: true,
      spec: designSpecSchema.parse(JSON.parse(JSON.stringify(SPEC))),
      verdict: verdict({ field: "palette.accent", value: "#2563EB" }),
      applied: { field: "palette.accent", from: "#F0B429", to: "#2563EB" },
    });

    expect(score.specChanged).toBe(false);
    expect(aggregateDesignJudge([score]).unchangedCorrections).toEqual([
      "case",
    ]);
  });

  it("names the guard that refused a value no enum member matches", () => {
    const score = scoreDesignJudgeCase(
      FACTS,
      refused({ field: "layout", value: "collage" }, { symptom: "repetitive" }),
    );

    expect(score.accepted).toBe(false);
    expect(score.refusedBy).toBe("value-unusable");
  });

  it("names the guard that refused a value already on the spec", () => {
    const score = scoreDesignJudgeCase(
      FACTS,
      refused({ field: "palette.accent", value: SPEC.palette.accent }),
    );

    expect(score.refusedBy).toBe("no-change");
  });

  /* The round-trip guard, from the eval's side: hero-center allows
     bottom-right, the footer band blocks it, resolveLogoPlacement puts the
     mark back and the field does not read back as prescribed. */
  it("names the guard that refused a corner the footer blocks", () => {
    const score = scoreDesignJudgeCase(
      FACTS,
      refused({ field: "logoPlacement", value: "bottom-right" }),
    );

    expect(score.refusedBy).toBe("overruled-downstream");
  });

  it("names the symptom map when the field is not one §11 treats it with", () => {
    const score = scoreDesignJudgeCase(
      FACTS,
      refused({ field: "footerStyle", value: "bar" }, { symptom: "off-brand" }),
    );

    expect(score.symptomTreatsField).toBe(false);
    expect(score.refusedBy).toBe("outside-symptom-map");
  });

  it("flags a field the route does not draw", () => {
    const score = scoreDesignJudgeCase(
      { ...FACTS, renderer: "native" },
      refused(
        { field: "footerLines", value: "0900 000 0000" },
        {
          symptom: "pasted-footer",
        },
      ),
    );

    expect(score.fieldDrawn).toBe(false);
    expect(score.refusedBy).toBe("field-not-drawn");
    expect(aggregateDesignJudge([score]).undrawnFields).toEqual(["case"]);
  });

  it("checks the ten scores against the manual's 1-5 scale", () => {
    const inRange = scoreDesignJudgeCase(
      FACTS,
      refused({ field: "layout", value: "collage" }, { symptom: "repetitive" }),
    );
    expect(inRange.scoresInRange).toBe(true);

    const outOfRange = scoreDesignJudgeCase(FACTS, {
      corrected: false,
      spec: SPEC,
      verdict: verdict(
        { field: "layout", value: "collage" },
        { scores: { ...scores(), hierarchy: 9 }, symptom: "repetitive" },
      ),
      applied: null,
    });
    expect(outOfRange.scoresInRange).toBe(false);
  });

  it("checks the judge looked at the render exactly when there was one", () => {
    const blind = scoreDesignJudgeCase(FACTS, {
      corrected: false,
      spec: SPEC,
      verdict: verdict(
        { field: "layout", value: "collage" },
        {
          sawImage: false,
          symptom: "repetitive",
        },
      ),
      applied: null,
    });
    expect(blind.sawImageAsExpected).toBe(false);

    const specOnly = scoreDesignJudgeCase(
      { ...FACTS, expectSawImage: false },
      {
        corrected: false,
        spec: SPEC,
        verdict: verdict(
          { field: "layout", value: "collage" },
          {
            sawImage: false,
            symptom: "repetitive",
          },
        ),
        applied: null,
      },
    );
    expect(specOnly.sawImageAsExpected).toBe(true);
  });
});

describe("aggregateDesignJudge", () => {
  const score = (over: Partial<DesignJudgeCaseScore>): DesignJudgeCaseScore =>
    ({
      ...scoreDesignJudgeCase(
        FACTS,
        accepted({ field: "palette.accent", value: "#2563EB" }),
      ),
      ...over,
    }) as DesignJudgeCaseScore;

  it("reports the acceptance rate as the share of cases accepted", () => {
    const totals = aggregateDesignJudge([
      score({ id: "a" }),
      score({ id: "b", accepted: false, refusedBy: "no-change" }),
      score({ id: "c", accepted: false, refusedBy: "no-change" }),
      score({ id: "d" }),
    ]);

    expect(totals.cases).toBe(4);
    expect(totals.acceptanceRate).toBe(0.5);
    expect(totals.refusals).toEqual({ "no-change": 2 });
  });

  /* A refusal the lane cannot attribute means its ladder has drifted from
     correct()'s. Reported rather than rounded away, because an acceptance rate
     whose refusals do not add up is not a measurement. */
  it("lists a refusal no guard accounts for", () => {
    const totals = aggregateDesignJudge([
      score({ id: "odd", accepted: false, refusedBy: null }),
    ]);

    expect(totals.unattributedRefusals).toEqual(["odd"]);
  });
});

describe("designJudgePassed", () => {
  const clean = aggregateDesignJudge([
    scoreDesignJudgeCase(
      FACTS,
      accepted({ field: "palette.accent", value: "#2563EB" }),
    ),
  ]);

  it("passes a clean run", () => {
    expect(designJudgePassed(clean, DESIGN_JUDGE_EVAL_THRESHOLDS)).toBe(true);
  });

  it("fails on an acceptance rate below the floor", () => {
    expect(
      designJudgePassed(
        { ...clean, acceptanceRate: 0.5 },
        DESIGN_JUDGE_EVAL_THRESHOLDS,
      ),
    ).toBe(false);
  });

  /* Hard failures, not low scores: each one is a defect the module was written
     to make unreachable, so no threshold can absorb it. */
  it("fails on an undrawn field however good the rest looks", () => {
    expect(
      designJudgePassed(
        { ...clean, acceptanceRate: 1, undrawnFields: ["a"] },
        DESIGN_JUDGE_EVAL_THRESHOLDS,
      ),
    ).toBe(false);
  });

  it("fails on a correction whose spec never changed", () => {
    expect(
      designJudgePassed(
        { ...clean, acceptanceRate: 1, unchangedCorrections: ["a"] },
        DESIGN_JUDGE_EVAL_THRESHOLDS,
      ),
    ).toBe(false);
  });

  it("fails when a verdict never came back", () => {
    expect(
      designJudgePassed(
        { ...clean, verdictRate: 0.9 },
        DESIGN_JUDGE_EVAL_THRESHOLDS,
      ),
    ).toBe(false);
  });
});

describe("the case set", () => {
  it("gives every case a spec the renderer's own schema accepts", () => {
    for (const evalCase of DESIGN_JUDGE_EVAL_CASES) {
      expect(designSpecSchema.safeParse(evalCase.spec).success).toBe(true);
    }
  });

  /* The lane measures a route-sensitive refusal surface — the native route
     draws no footer and no layout — so a set that only ever exercises one
     route measures half the guards. */
  it("covers both renderers", () => {
    const renderers = new Set(DESIGN_JUDGE_EVAL_CASES.map((c) => c.renderer));
    expect(renderers).toEqual(new Set(["composite", "native"]));
  });

  /* The judge is only ever reached from a fault in CORRECTABLE, and it is only
     shown the render when there is one worth showing. Both halves need cases
     or the lane measures one path. */
  it("covers the image, the flat frame and the missing bytes", () => {
    const images = new Set(DESIGN_JUDGE_EVAL_CASES.map((c) => c.image));
    expect(images).toEqual(new Set(["render", "flat", "none"]));
  });

  it("builds one case for each symptom §11 names", () => {
    const presented = new Set(DESIGN_JUDGE_EVAL_CASES.map((c) => c.presents));
    expect(presented.size).toBe(DESIGN_JUDGE_EVAL_CASES.length);
    expect(presented.size).toBeGreaterThanOrEqual(9);
  });

  it("gives every case a unique id", () => {
    const ids = DESIGN_JUDGE_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
