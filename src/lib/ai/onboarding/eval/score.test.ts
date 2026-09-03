import { describe, expect, it } from "vitest";
import { extractionSchema } from "@/lib/ai/onboarding/extraction";
import { formatChipSelection } from "@/lib/onboarding/chips";
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

/* The chip cases exist to prove a tap reaches the right column. They only do
   that if their transcripts carry the sentences formatChipSelection actually
   produces — otherwise the eval passes against wording the product never
   emits, which is worse than no case at all. */
describe("chip eval transcripts use the real sentences", () => {
  const byId = new Map(EXTRACTION_EVAL_CASES.map((c) => [c.id, c]));

  it.each([
    ["chip-selections", "tone", ["Bold", "Warm", "Playful"]],
    ["chip-selections", "avoid", ["Synergy", "Cheap", "Guaranteed"]],
    [
      "competitor-poll-directions",
      "differentiation",
      ["Bespoke service", "Local expertise"],
    ],
    [
      "competitor-poll-directions",
      "competitor-strengths",
      ["Bigger budget", "Wider reach"],
    ],
    [
      "distribution-polls",
      "platforms",
      ["Instagram", "TikTok", "Email / Newsletter"],
    ],
    ["distribution-polls", "primary-platform", ["Instagram"]],
    ["distribution-polls", "posting-cadence", ["3–4x / week"]],
  ] as const)("%s carries the %s sentence verbatim", (id, kind, picks) => {
    const transcript = byId.get(id)?.transcript ?? "";
    expect(transcript).toContain(formatChipSelection(kind, [...picks]));
  });

  /* The direction is the whole point of the case: if the two expectations
     were swapped it would still pass while the columns were inverted. */
  it("expects each poll's answer in its own column", () => {
    const c = byId.get("competitor-poll-directions");
    expect(c?.expected.differentiators?.contains).toEqual(["bespoke"]);
    expect(c?.expected.competitorStrengths?.contains).toEqual(["budget"]);
  });

  /* Same hazard, different columns: every distribution sentence names a
     channel, so a swap between platforms and primaryPlatform would still
     score green while the strategy led with the wrong one. */
  it("keeps the primary channel out of the active-channels column", () => {
    const c = byId.get("distribution-polls");
    /* Different needles on purpose — a shared one cannot see a swap. */
    expect(c?.expected.platforms?.contains).toEqual(["tiktok"]);
    expect(c?.expected.primaryPlatform?.contains).toEqual(["instagram"]);
    expect(c?.expected.platforms?.contains).not.toEqual(
      c?.expected.primaryPlatform?.contains,
    );
  });
});

/* The gap that let a whole ticket's answers be collected and thrown away: an
   eval case can name a field the extractor cannot produce, and scoreCase just
   counts it as missed. Nothing else connects the cases to the schema. */
describe("every eval expectation is a field the extractor can actually fill", () => {
  const extractable = new Set(Object.keys(extractionSchema.shape.fields.shape));

  it.each(EXTRACTION_EVAL_CASES.map((c) => [c.id, c] as const))(
    "%s expects only extractable fields",
    (_id, c) => {
      for (const key of Object.keys(c.expected)) {
        expect(extractable).toContain(key);
      }
    },
  );

  it.each(EXTRACTION_EVAL_CASES.map((c) => [c.id, c] as const))(
    "%s forbids only extractable fields",
    (_id, c) => {
      for (const key of c.forbidden ?? []) {
        expect(extractable).toContain(key);
      }
    },
  );
});

/* B3/B4 guards. scoreCase counts `forbidden` hits into `invented`, which is
   capped at 1 per case — so a duplicated key can flip a green case red on a
   paid run, and a field nobody forbids anywhere can be invented for free. */
describe("the forbidden lists are sound", () => {
  it.each(EXTRACTION_EVAL_CASES.map((c) => [c.id, c] as const))(
    "%s forbids each field at most once",
    (_id, c) => {
      const forbidden = c.forbidden ?? [];
      expect(new Set(forbidden).size).toBe(forbidden.length);
    },
  );

  /* The sparse case is the invention canary — a near-empty transcript is where
     a model is most tempted to fill columns from nothing. Every extractable
     field it does not expect must be forbidden there, or a new field arrives
     with no invention guard at all. */
  it("guards every extractable field in the sparse case", () => {
    const sparse = EXTRACTION_EVAL_CASES.find(
      (c) => c.id === "sparse-two-facts",
    );
    if (!sparse) throw new Error("sparse-two-facts case is missing");
    const covered = new Set([
      ...Object.keys(sparse.expected),
      ...(sparse.forbidden ?? []),
    ]);
    for (const key of Object.keys(extractionSchema.shape.fields.shape)) {
      expect(covered).toContain(key);
    }
  });
});

describe("notContains catches crosstalk a positive anchor cannot", () => {
  const c: ExtractionEvalCase = {
    id: "x",
    transcript: "",
    expected: {
      platforms: { contains: ["tiktok"] },
      primaryPlatform: {
        contains: ["instagram"],
        notContains: ["tiktok"],
      },
    },
    forbidden: [],
  };

  it("accepts one channel in the primary column", () => {
    const s = scoreCase(c, {
      platforms: "Instagram, TikTok",
      primaryPlatform: "Instagram",
    });
    expect(s.wrongValue).toEqual([]);
  });

  /* The failure the case exists for: the model copies the whole list into
     both columns. Every `contains` anchor still matches. */
  it("rejects the whole list copied into the primary column", () => {
    const s = scoreCase(c, {
      platforms: "Instagram, TikTok",
      primaryPlatform: "Instagram, TikTok",
    });
    expect(s.wrongValue).toEqual(["primaryPlatform"]);
  });
});
