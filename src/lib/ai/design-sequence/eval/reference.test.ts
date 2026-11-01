import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEQUENCE_EVAL_CASES, SEQUENCE_HELD_OUT_CASES } from "./cases";
import { buildJudgePrompt } from "./judge";
import {
  JOB_FATAL_RULES,
  PANEL_GROUPS,
  parseReference,
  REFERENCE_FILES,
  REFERENCE_SHA256,
} from "./panel";

const read = (group: "expert" | "floor") =>
  readFileSync(REFERENCE_FILES[group], "utf8");
const allCases = [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES];

describe("the frozen panel reference (rubric Addendum B)", () => {
  it.each(["expert", "floor"] as const)(
    "%s.json is byte for byte the calibrated set",
    (group) => {
      const digest = createHash("sha256").update(read(group)).digest("hex");
      expect(digest).toBe(REFERENCE_SHA256[group]);
    },
  );

  it("holds the same 8 fixtures at the same N and kind in both", () => {
    const expert = parseReference(read("expert"));
    const floor = parseReference(read("floor"));
    expect(expert).toHaveLength(8);
    const shape = (sets: typeof expert) =>
      sets.map((s) => `${s.fixtureId}/${s.kind}/${s.frames.length}`);
    expect(shape(floor)).toEqual(shape(expert));
  });

  it("names only fixtures the eval has, of the kind it has them", () => {
    for (const set of parseReference(read("expert"))) {
      const c = allCases.find((x) => x.id === set.fixtureId);
      expect(c?.kind).toBe(set.kind);
      if (c) expect(buildJudgePrompt(c, set)).toContain(set.frames[0].headline);
    }
  });

  it("judges three groups", () => {
    expect(PANEL_GROUPS).toEqual(["expert", "ours", "floor"]);
  });
});

describe("JOB_FATAL_RULES", () => {
  it("is the job's own FATAL_RULES list", () => {
    const job = readFileSync("src/lib/jobs/run-design-sequence.ts", "utf8");
    const body = /const FATAL_RULES[^=]*=\s*\[([^\]]*)\]/.exec(job)?.[1];
    expect(body).toBeDefined();
    const rules = [...(body ?? "").matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    expect(rules).toEqual([...JOB_FATAL_RULES]);
  });
});
