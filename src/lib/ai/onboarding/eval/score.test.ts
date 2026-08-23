import { describe, expect, it } from "vitest";
import {
  EXTRACTION_EVAL_CASES,
  EXTRACTION_EVAL_THRESHOLDS,
  type ExtractionEvalCase,
} from "./cases";
import { aggregate, casePassed, scoreCase } from "./score";

const evalCase: ExtractionEvalCase = {
  id: "t",
  transcript: "irrelevant to scoring",
  expected: {
    name: { contains: ["acme"] },
    tone: { contains: ["warm"] },
  },
  forbidden: ["competitors"],
};

describe("scoreCase", () => {
  it("scores a perfect extraction", () => {
    const score = scoreCase(evalCase, { name: "Acme", tone: "Warm and bold" });
    expect(score).toMatchObject({
      recall: 1,
      valueAccuracy: 1,
      invented: [],
      missed: [],
      wrongValue: [],
    });
  });

  it("counts an unfilled expected field as missed, not wrong", () => {
    const score = scoreCase(evalCase, { name: "Acme" });
    expect(score.missed).toEqual(["tone"]);
    expect(score.wrongValue).toEqual([]);
    expect(score.recall).toBe(0.5);
  });

  it("treats an empty string as unfilled, matching the sentinel", () => {
    expect(scoreCase(evalCase, { name: "Acme", tone: "   " }).missed).toEqual([
      "tone",
    ]);
  });

  it("flags a filled field whose value misses the transcript's anchor", () => {
    const score = scoreCase(evalCase, { name: "Acme", tone: "icy" });
    expect(score.recall).toBe(1);
    expect(score.wrongValue).toEqual(["tone"]);
    expect(score.valueAccuracy).toBe(0.5);
  });

  it("matches anchors case-insensitively", () => {
    expect(scoreCase(evalCase, { name: "ACME", tone: "WARM" }).recall).toBe(1);
  });

  /* The failure that actually hurts: the user confirms an invented value onto
     their brand profile with no reason to doubt it. */
  it("reports a filled forbidden field as invented", () => {
    const score = scoreCase(evalCase, {
      name: "Acme",
      tone: "warm",
      competitors: "Nike, Adidas",
    });
    expect(score.invented).toEqual(["competitors"]);
  });
});

describe("casePassed", () => {
  const t = { minRecall: 0.8, minValueAccuracy: 0.85, maxInventedPerCase: 1 };

  it("passes a clean score", () => {
    expect(
      casePassed(
        {
          id: "t",
          recall: 1,
          valueAccuracy: 1,
          invented: [],
          missed: [],
          wrongValue: [],
        },
        t,
      ),
    ).toBe(true);
  });

  it("fails on recall below the bar", () => {
    expect(
      casePassed(
        {
          id: "t",
          recall: 0.5,
          valueAccuracy: 1,
          invented: [],
          missed: ["tone"],
          wrongValue: [],
        },
        t,
      ),
    ).toBe(false);
  });

  it("fails on too much invention even with perfect recall", () => {
    expect(
      casePassed(
        {
          id: "t",
          recall: 1,
          valueAccuracy: 1,
          invented: ["competitors", "values"],
          missed: [],
          wrongValue: [],
        },
        t,
      ),
    ).toBe(false);
  });
});

describe("aggregate", () => {
  it("means the rates and sums the invention", () => {
    expect(
      aggregate([
        {
          id: "a",
          recall: 1,
          valueAccuracy: 1,
          invented: ["x"],
          missed: [],
          wrongValue: [],
        },
        {
          id: "b",
          recall: 0.5,
          valueAccuracy: 0.5,
          invented: [],
          missed: [],
          wrongValue: [],
        },
      ]),
    ).toEqual({ recall: 0.75, valueAccuracy: 0.75, invented: 1 });
  });

  it("returns zeroes rather than NaN for an empty run", () => {
    expect(aggregate([])).toEqual({
      recall: 0,
      valueAccuracy: 0,
      invented: 0,
    });
  });
});

describe("EXTRACTION_EVAL_CASES", () => {
  it("has unique ids", () => {
    const ids = EXTRACTION_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* An expected key that is also forbidden would make the case unpassable. */
  it("never expects and forbids the same field", () => {
    for (const c of EXTRACTION_EVAL_CASES) {
      const overlap = Object.keys(c.expected).filter((k) =>
        c.forbidden.includes(k),
      );
      expect(overlap, `case ${c.id}`).toEqual([]);
    }
  });

  it("anchors every expected field to a substring of its transcript", () => {
    for (const c of EXTRACTION_EVAL_CASES) {
      for (const [key, { contains }] of Object.entries(c.expected)) {
        expect(contains.length, `${c.id}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("keeps the invention bar strict", () => {
    expect(EXTRACTION_EVAL_THRESHOLDS.maxInventedPerCase).toBeLessThanOrEqual(
      1,
    );
  });
});
